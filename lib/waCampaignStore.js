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
import { cleanAudience, matchCampaignMessage, neededFields, skipReason, recipientKey, retargetRows, campaignResults, isSimPhone, SIM_PHONES, SIM_TAG } from './waCampaigns.js';
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
// One row per person of the batch. meta.key = who it is across batches (lead:/user:/phone);
// a test batch's simulated row keeps the real number in meta.real_phone (never sent to).
export async function addRecipients(campaign, recipients, optIn, optedOut, marketing, varsMap = {}) {
  const fields = neededFields(varsMap);
  const rows = recipients.map((r) => {
    const skipped = skipReason(r, optIn, optedOut, { marketing, fields });
    return {
      automation_id: CAMPAIGN, run_id: campaign.id, channel: 'whatsapp', to_email: r.email || '', to_phone: r.phone,
      subject: `WhatsApp · ${campaign.template}`, template_key: `campaign:${campaign.name}`.slice(0, 120),
      status: skipped ? 'failed' : 'sending', dedupe_key: `wacmp:${campaign.id}:${recipientKey(r)}:wa`,
      error: JSON.stringify({ name: r.name || null, source: r.source || null, key: recipientKey(r), ...(r.sim ? { sim: true, real_phone: r.real_phone } : {}), ...(skipped ? { skipped } : {}) }),
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
  // the simulation numbers are their own contacts (ensureSimContacts); one upsert per phone
  const queue = [...new Map(recipients.filter((r) => !r.sim).map((r) => [r.phone, r])).values()];
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

// The 10 simulation numbers as Relay contacts (tag cl-sim), for test batches. Contacts are
// shared by the live and test keys, so the live audiences leave them out (loadAudience) and
// a live send refuses them (liveProblem).
export async function ensureSimContacts() {
  await Promise.all(SIM_PHONES.map((phone, i) => relay('test', '/contacts', { method: 'POST', json: { phone, name: `Simulación ${String(i + 1).padStart(2, '0')} (solo pruebas)`, add_tags: [SIM_TAG] } }).catch(() => null)));
  optCache.delete('test');
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
  if (campaign.demo) return { checked: 0, updated: 0 };   // demo batches: nothing was sent
  const recipients = await listRecipients(campaign.id);
  const todo = recipients.filter((r) => !r.meta.skipped && (r.status !== 'read' || !r.meta.replied_at));
  let updated = 0;
  const queue = [...todo];
  // one read per phone (a test batch puts many people on the same simulation number)
  const convs = new Map();
  const messagesOf = (phone) => {
    if (!convs.has(phone)) convs.set(phone, relay(campaign.mode, `/conversations/${phoneParam(phone)}/messages?limit=30`).catch(() => ({ ok: false })));
    return convs.get(phone);
  };
  const worker = async () => {
    while (queue.length) {
      const r = queue.shift();
      const res = await messagesOf(r.phone);
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
  if (mode === 'test' && recipients.some((r) => r.sim)) await ensureSimContacts();
  try {
    const r = await sendToRelay(mode, { ...settings }, [...new Set(recipients.map((x) => x.phone))]);
    const saved = await saveCampaign(id, { state: settings.send_at ? 'scheduled' : 'sent', relay_id: r.id, relay_status: r.status, relay_audience: r.audience, unknown_phones: r.unknown_phones, contacts: up, sent_at: new Date().toISOString() });
    return { ok: true, id, state: saved.state, relay: r };
  } catch (e) {
    await saveCampaign(id, { state: 'failed', fail_reason: String(e?.message || e), contacts: up });
    return { ok: false, id, error: String(e?.message || e) };
  }
}

// Batch slug (utm_campaign wc-…) → its name, for the analytics sources ("WhatsApp
// campaign · Agentes — lote 2"). Per country, cached 60 s.
const namesCache = (globalThis.__clWaBatchNames ||= new Map());
export async function batchNames() {
  const cc = activeCountry();
  const hit = namesCache.get(cc);
  if (hit && Date.now() - hit.at < 60_000) return hit.map;
  const map = new Map((await listCampaigns().catch(() => [])).filter((c) => c.slug).map((c) => [c.slug, c.name]));
  namesCache.set(cc, { at: Date.now(), map });
  return map;
}

// ── batches overview ─────────────────────────────────────────────────────────
// Every campaign (batch) with its totals, for the Sent campaigns tab: one read of all the
// recipient rows, grouped by campaign. clicksFor(slugs) → Map slug → people who opened the link.
export async function campaignsWithResults(clicksFor = async () => new Map()) {
  const [camps, rows] = await Promise.all([
    listCampaigns(),
    selectAll(db(), 'email_log', `select=id,run_id,status,error&automation_id=eq.${CAMPAIGN}&channel=eq.whatsapp&order=id.asc`),
  ]);
  const clicksBySlug = await clicksFor(camps.map((c) => c.slug));
  const by = new Map();
  for (const r of rows) { const k = String(r.run_id); if (!by.has(k)) by.set(k, []); by.get(k).push({ status: r.status, meta: meta(r) }); }
  return camps.map((c) => ({ ...c, results: campaignResults(by.get(String(c.id)) || [], clicksBySlug.get(c.slug) || 0) }));
}

// Who earlier batches of this mode already had (test and demo batches count for test mode
// only), so "skip people already in an earlier batch" gives the NEXT N. A batch Relay refused
// reached nobody: it doesn't count.
export async function batchedKeys(mode) {
  const camps = (await listCampaigns()).filter((c) => (c.mode === 'test' ? 'test' : 'live') === mode && c.state !== 'failed');
  if (!camps.length) return new Set();
  const keys = new Set();
  for (let i = 0; i < camps.length; i += 40) {
    const ids = camps.slice(i, i + 40).map((c) => c.id).join(',');
    const rows = await selectAll(db(), 'email_log', `select=id,to_phone,error&automation_id=eq.${CAMPAIGN}&channel=eq.whatsapp&run_id=in.(${ids})&order=id.asc`);
    for (const r of rows) keys.add(meta(r).key || r.to_phone);
  }
  return keys;
}

// ── audiences ────────────────────────────────────────────────────────────────
// source: users | leads | relay | phones | batch;  segment per source (see the page);
// batch: segment = the earlier campaign's id, batchFilter = who of it (BATCH_FILTERS).
// Every row carries `key` (lead:<id> / user:<id>) so batches can leave out who already had one.
export async function loadAudience({ source, segment = 'all', phones = '', mode = 'live', batchFilter = 'all' }) {
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
    rows = users.map((u) => ({ phone: u.phone, name: u.full_name, email: u.email, source: 'user', key: `user:${u.id}`, optedOut: !!u.whatsapp_opted_out_at }));
  } else if (source === 'leads') {
    // oldest first, so "first 100" / "next 100" always mean the same people
    let leads = await selectAll(d, 'potential_leads', 'select=id,name,phone,whatsapp,email,category,created_at&order=created_at.asc,id.asc');
    if (segment !== 'all') leads = leads.filter((l) => String(l.category || '') === segment);
    rows = leads.map((l) => ({ phone: l.whatsapp || l.phone, name: l.name, email: l.email, source: 'lead', key: `lead:${l.id}` }));
  } else if (source === 'batch') {
    const from = await getCampaign(segment);
    if (!from) throw new Error('That batch no longer exists.');
    rows = retargetRows(await listRecipients(from.id), batchFilter);
  } else if (source === 'relay') {
    const out = [];
    let cursor = null;
    const filter = segment === 'opted_in' ? '&opt_in_status=opted_in' : segment.startsWith('tag:') ? `&tag=${q(segment.slice(4))}` : '';
    for (let page = 0; page < 60; page++) {
      const r = await relay(mode, `/contacts?limit=200${filter}${cursor ? `&cursor=${q(cursor)}` : ''}`);
      if (!r.ok) throw new Error(r.data?.error?.message || `Relay ${r.status}`);
      // the simulation numbers are contacts too (shared with live): never in a live audience
      for (const c of r.data.data || []) if (mode === 'test' || (!isSimPhone(c.phone) && !(c.tags || []).includes(SIM_TAG))) out.push({ phone: c.phone, name: c.name, email: c.email, source: 'relay' });
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
