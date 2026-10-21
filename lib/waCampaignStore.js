// Server side of WhatsApp campaigns (lib/waCampaigns.js has the rules).
// Storage — no migration: the active country's email_log, which already has the WhatsApp
// columns (017) and whose statuses the website's Relay webhook keeps current (018):
//   the campaign  = one row: automation_id 'wa_campaign', channel 'wa_campaign',
//                   subject = name, template_key = template, error = JSON settings/state
//   recipients    = one row each: automation_id 'wa_campaign', run_id = the campaign row,
//                   channel 'whatsapp', to_phone, status sending → sent/delivered/read/failed,
//                   relay_message_id once found, error = JSON { skipped?, replied_at? }
// Every dedupe_key ends in ':wa' so the email pages never list them (EMAIL_ONLY).
import 'server-only';
import { dbFor } from './db.js';
import { activeCountry } from './adminCountry.js';
import { relay, phoneParam } from './relayInbox.js';
import { selectAll } from './selectAll.js';
import { HIDE_DELETED_USERS } from './userInsights.js';
import { PHONE_PREFIX } from './paidListingsAdmin.js';
import { cleanAudience, matchCampaignMessage, neededFields, missingValue } from './waCampaigns.js';
import { isInternalEmail, INTERNAL_NAMES } from './internalTraffic.js';
import { internalEmails } from './internalAudience.js';
import { listingPhones } from './listingPhones.js';

export const CAMPAIGN = 'wa_campaign';
const q = encodeURIComponent;
const meta = (row) => { try { return JSON.parse(row?.error || '{}') || {}; } catch { return {}; } };
export const prefixNow = () => PHONE_PREFIX[activeCountry()] || '595';
const db = () => dbFor(activeCountry());

// ── campaigns ────────────────────────────────────────────────────────────────
const toCampaign = (row) => ({ id: row.id, name: row.subject, template: row.template_key, created_at: row.created_at, ...meta(row) });

export async function listCampaigns() {
  const rows = await db().select('email_log', `select=id,subject,template_key,status,error,created_at&automation_id=eq.${CAMPAIGN}&channel=eq.wa_campaign&order=created_at.desc&limit=200`);
  return rows.map(toCampaign);
}
export async function getCampaign(id) {
  const [row] = await db().select('email_log', `select=id,subject,template_key,status,error,created_at&id=eq.${q(id)}&automation_id=eq.${CAMPAIGN}&channel=eq.wa_campaign&limit=1`);
  return row ? toCampaign(row) : null;
}
export async function saveCampaign(id, patch) {
  const cur = await getCampaign(id);
  const { name, template, id: _id, created_at: _c, ...rest } = { ...cur, ...patch };
  await db().update('email_log', `id=eq.${q(id)}`, { error: JSON.stringify(rest) }, { returning: 'minimal' });
  return { ...cur, ...patch };
}
export async function createCampaign({ name, template, settings }) {
  const key = `wacmp:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}:wa`;
  const [row] = await db().insert('email_log', [{
    automation_id: CAMPAIGN, channel: 'wa_campaign', to_email: '', subject: name, template_key: template,
    status: settings.mode === 'test' ? 'test' : 'sending', dedupe_key: key, error: JSON.stringify(settings),
  }]);
  return toCampaign(row);
}
export async function deleteCampaign(id) {
  await db().remove('email_log', `run_id=eq.${q(id)}&automation_id=eq.${CAMPAIGN}`);
  await db().remove('email_log', `id=eq.${q(id)}&automation_id=eq.${CAMPAIGN}`);
}

// ── recipients ───────────────────────────────────────────────────────────────
const toRecipient = (row) => ({ id: row.id, phone: row.to_phone, email: row.to_email || null, status: row.status, relay_message_id: row.relay_message_id || null, created_at: row.created_at, meta: meta(row) });
export async function listRecipients(campaignId) {
  const rows = await selectAll(db(), 'email_log', `select=id,to_phone,to_email,status,relay_message_id,error,created_at&run_id=eq.${q(campaignId)}&automation_id=eq.${CAMPAIGN}&order=id.asc`);
  return rows.map(toRecipient);
}
export async function addRecipients(campaign, recipients, optIn, optedOut, marketing, varsMap = {}) {
  const fields = neededFields(varsMap);
  const rows = recipients.map((r) => {
    const st = optIn.get(r.phone) || 'unknown';
    const skipped = st === 'opted_out' || optedOut.has(r.phone) ? 'opted_out' : st !== 'opted_in' ? 'no_opt_in' : marketing && r.phone.startsWith('+1') ? 'us_marketing' : missingValue(r, fields) ? 'missing_value' : null;
    return {
      automation_id: CAMPAIGN, run_id: campaign.id, channel: 'whatsapp', to_email: r.email || '', to_phone: r.phone,
      subject: `WhatsApp · ${campaign.template}`, template_key: `campaign:${campaign.name}`.slice(0, 120),
      status: skipped ? 'failed' : 'sending', dedupe_key: `wacmp:${campaign.id}:${r.phone}:wa`,
      error: JSON.stringify({ name: r.name || null, source: r.source || null, ...(skipped ? { skipped } : {}) }),
    };
  });
  for (let i = 0; i < rows.length; i += 500) await db().insert('email_log', rows.slice(i, i + 500), { returning: 'minimal' });
  return rows.length;
}
async function saveRecipient(r, patch) {
  const m = { ...r.meta, ...(patch.meta || {}) };
  const row = { ...(patch.status ? { status: patch.status } : {}), ...(patch.relay_message_id ? { relay_message_id: patch.relay_message_id } : {}), error: JSON.stringify(m) };
  await db().update('email_log', `id=eq.${q(r.id)}`, row, { returning: 'minimal' });
}

// ── Relay ────────────────────────────────────────────────────────────────────
// Every Relay contact of this mode → Map phone → opt-in status. Cached 60 s.
const optCache = (globalThis.__clWaOptIn ||= new Map());
export async function relayOptIns(mode, { fresh = false } = {}) {
  const hit = optCache.get(mode);
  if (!fresh && hit && Date.now() - hit.at < 60_000) return hit.data;
  const map = new Map();
  const tags = new Set();
  let cursor = null;
  for (let page = 0; page < 60; page++) {
    const r = await relay(mode, `/contacts?limit=200${cursor ? `&cursor=${q(cursor)}` : ''}`);
    if (!r.ok) throw new Error(r.data?.error?.message || `Relay ${r.status}`);
    for (const c of r.data.data || []) { map.set(c.phone, c.opt_in?.status || 'unknown'); for (const t of c.tags || []) tags.add(t); }
    if (!r.data.has_more || !r.data.next_cursor) break;
    cursor = r.data.next_cursor;
  }
  const data = { map, tags: [...tags].sort(), contacts: map.size };
  optCache.set(mode, { at: Date.now(), data });
  return data;
}

// Upsert each recipient as a Relay contact (a campaign only reaches existing contacts):
// name / email / tag only — the opt-in is NEVER touched here, in live or test mode
// (Relay's contacts are shared by both modes: a test opt-in would be a real one).
export async function upsertContacts(mode, recipients, tag) {
  let ok = 0, failed = 0;
  const queue = [...recipients];
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      const body = { phone: r.phone, ...(r.name ? { name: r.name } : {}), ...(r.email ? { email: r.email } : {}), add_tags: [tag] };
      const res = await relay(mode, '/contacts', { method: 'POST', json: body }).catch(() => ({ ok: false }));
      if (res.ok) ok++; else failed++;
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  optCache.delete(mode);
  return { ok, failed };
}

export async function sendToRelay(mode, campaign, phones) {
  const res = await relay(mode, '/campaigns', {
    method: 'POST',
    json: {
      name: campaign.name, template: campaign.template, language: campaign.language || 'es_MX',
      audience: { phones }, variables: campaign.variables || { body: [] },
      ...(campaign.send_at ? { send_at: campaign.send_at } : {}),
    },
  });
  if (!res.ok) throw Object.assign(new Error(res.data?.error?.message || res.data?.error?.code || `Relay ${res.status}`), { status: res.status, code: res.data?.error?.code });
  return res.data;   // { id, status, scheduled_at, audience: { matched, eligible, skipped }, unknown_phones, mode }
}

// Read each waiting / recent recipient's conversation → status, message id, reply.
export async function refreshResults(campaign) {
  const recipients = await listRecipients(campaign.id);
  const todo = recipients.filter((r) => !r.meta.skipped && (r.status !== 'read' || !r.meta.replied_at));
  let updated = 0;
  const queue = [...todo];
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      const res = await relay(campaign.mode, `/conversations/${phoneParam(r.phone)}/messages?limit=30`).catch(() => ({ ok: false }));
      if (!res.ok) continue;
      const hit = matchCampaignMessage(res.data?.data || [], { template: campaign.template, sentAt: campaign.sent_at || campaign.created_at });
      if (!hit) {
        // Relay never sent it (it skips people it can't fill or reach): after 15 min, say so.
        const since = Date.parse(campaign.send_at || campaign.sent_at || campaign.created_at);
        if (r.status === 'sending' && Date.now() - since > 15 * 60_000) { await saveRecipient(r, { status: 'failed', meta: { skipped: 'not_sent' } }); updated++; }
        continue;
      }
      const status = ['sent', 'delivered', 'read', 'failed'].includes(hit.message.status) ? hit.message.status : r.status;
      const metaPatch = { ...(hit.replied_at ? { replied_at: hit.replied_at } : {}), ...(hit.message.error ? { error: String(hit.message.error?.code || hit.message.error?.message || hit.message.error) } : {}) };
      if (status !== r.status || hit.message.id !== r.relay_message_id || (hit.replied_at && !r.meta.replied_at)) {
        await saveRecipient(r, { status, relay_message_id: hit.message.id, meta: metaPatch });
        updated++;
      }
    }
  };
  await Promise.all(Array.from({ length: 5 }, worker));
  await saveCampaign(campaign.id, { refreshed_at: new Date().toISOString() });
  return { checked: todo.length, updated };
}

// Upsert contacts, then Relay's POST /v1/campaigns (also used for drafts: /api/campaigns/[id]).
export async function sendCampaign(id, { mode, recipients, settings }) {
  const up = await upsertContacts(mode, recipients, `cl-campaign`);
  try {
    const r = await sendToRelay(mode, { ...settings }, recipients.map((x) => x.phone));
    const saved = await saveCampaign(id, { state: settings.send_at ? 'scheduled' : 'sent', relay_id: r.id, relay_status: r.status, relay_audience: r.audience, unknown_phones: r.unknown_phones, contacts: up, sent_at: new Date().toISOString() });
    return { ok: true, id, state: saved.state, relay: r };
  } catch (e) {
    await saveCampaign(id, { state: 'failed', fail_reason: String(e?.message || e), contacts: up });
    return { ok: false, id, error: String(e?.message || e) };
  }
}

// ── audiences ────────────────────────────────────────────────────────────────
// source: users | leads | relay | phones;  segment per source (see the page)
export async function loadAudience({ source, segment = 'all', phones = '', mode = 'live' }) {
  const prefix = prefixNow();
  const d = db();
  let rows = [];
  if (source === 'users') {
    // everyone with a phone: on their profile, or on their newest listing (sellers before
    // the buyer portal copied it to the profile — lib/listingPhones.js)
    let users = await selectAll(d, 'users', `select=id,email,full_name,phone,phone_verified_at,whatsapp_opted_out_at&${HIDE_DELETED_USERS}&order=id.asc`);
    const fromListing = await listingPhones(d.select, users.filter((u) => !u.phone).map((u) => u.id)).catch(() => new Map());
    users = users.map((u) => (u.phone ? u : { ...u, phone: fromListing.get(String(u.id)) || null })).filter((u) => u.phone);
    // the team's own / test accounts never get a campaign (same rule as the rest of the admin:
    // team emails, .pk, the internal names, and Pakistan numbers)
    const extra = await internalEmails(activeCountry()).catch(() => null);
    users = users.filter((u) => !isInternalEmail(u.email, extra) && !INTERNAL_NAMES.includes(String(u.full_name || '').trim().toLowerCase()) && !/^\+?92/.test(String(u.phone || '').replace(/[^\d+]/g, '')));
    if (segment === 'verified') users = users.filter((u) => u.phone_verified_at);
    if (segment === 'sellers' || segment === 'no_listing') {
      const props = await selectAll(d, 'properties', 'select=id,created_by&origin=eq.user&created_by=not.is.null&order=id.asc');
      const sellers = new Set(props.map((p) => String(p.created_by)));
      users = users.filter((u) => (segment === 'sellers') === sellers.has(String(u.id)));
    }
    rows = users.map((u) => ({ phone: u.phone, name: u.full_name, email: u.email, source: 'user', optedOut: !!u.whatsapp_opted_out_at }));
  } else if (source === 'leads') {
    let leads = await selectAll(d, 'potential_leads', 'select=id,name,phone,whatsapp,email,category&order=id.asc');
    if (segment !== 'all') leads = leads.filter((l) => String(l.category || '') === segment);
    rows = leads.map((l) => ({ phone: l.whatsapp || l.phone, name: l.name, email: l.email, source: 'lead' }));
  } else if (source === 'relay') {
    const out = [];
    let cursor = null;
    const filter = segment === 'opted_in' ? '&opt_in_status=opted_in' : segment.startsWith('tag:') ? `&tag=${q(segment.slice(4))}` : '';
    for (let page = 0; page < 60; page++) {
      const r = await relay(mode, `/contacts?limit=200${filter}${cursor ? `&cursor=${q(cursor)}` : ''}`);
      if (!r.ok) throw new Error(r.data?.error?.message || `Relay ${r.status}`);
      for (const c of r.data.data || []) out.push({ phone: c.phone, name: c.name, email: c.email, source: 'relay' });
      if (!r.data.has_more || !r.data.next_cursor) break;
      cursor = r.data.next_cursor;
    }
    rows = out;
  } else if (source === 'phones') {
    rows = String(phones).split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((p) => ({ phone: p, source: 'pasted' }));
  }
  const optedOut = new Set(rows.filter((r) => r.optedOut).map((r) => r.phone));
  const { recipients, invalid } = cleanAudience(rows, prefix);
  const out = new Set([...optedOut].map((p) => cleanAudience([{ phone: p }], prefix).recipients[0]?.phone).filter(Boolean));
  return { recipients, invalid, optedOut: out, noPhone: 0 };
}
