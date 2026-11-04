// Admin Manager — send the "views but no contacts" advice for one country (lib/manager/viewsAdvice.js).
// Called by every report run. Server only.
// WhatsApp first: the WhatsApp template cl_visitas_sin_contacto (Relay) when Meta approved it and
// the seller has a number (adviceChannel), else the email as before. A failed WhatsApp send falls
// back to the email in the same run. Env: MANAGER_WHATSAPP_TO (local / staging) sends every
// WhatsApp to that number instead; with MANAGER_SEND_TO set and no MANAGER_WHATSAPP_TO, a test
// run never WhatsApps a real seller (email only, redirected as before).
import 'server-only';
import { dbFor } from '../db.js';
import { selectAll } from '../selectAll.js';
import { countryInfo } from '../automationAdmin.js';
import { isInternalEmail } from '../internalTraffic.js';
import { internalEmails } from '../internalAudience.js';
import { sendManagerEmail } from '../email.js';
import { viewsFor } from '../openIssuesStore.js';
import { relayTemplates } from '../relayAdmin.js';
import { relay, inboxMode } from '../relayInbox.js';
import { WA_COUNTRIES, WA_LANGUAGE } from '../whatsappTemplates.js';
import { ADVICE, ADVICE_ID, ADVICE_WA, pickAdvice, adviceEmail, listingOfKey, adviceChannel, adviceWaApproved } from './viewsAdvice.js';

const D = 86400000;
const enc = encodeURIComponent;
const inList = (ids) => `in.(${ids.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;

// Is the WhatsApp version usable for this country right now?
async function whatsappReady(country) {
  if (!WA_COUNTRIES.includes(String(country || '').toLowerCase())) return false;
  if (String(process.env.MANAGER_SEND_TO || '').trim() && !String(process.env.MANAGER_WHATSAPP_TO || '').trim()) return false;
  return relayTemplates().then((d) => adviceWaApproved(d?.templates || [])).catch(() => false);
}

async function sendWhatsApp(via, p, key) {
  const res = await relay(inboxMode(), '/messages/template', {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    json: { to: via.to, template: ADVICE_WA, language: WA_LANGUAGE, variables: via.variables, metadata: { source: ADVICE_ID, listing: String(p.listing.id), user: String(p.user.id) } },
  }).catch((e) => ({ ok: false, data: { error: { message: String(e?.message || e) } } }));
  return res.ok ? { ok: true, id: res.data?.id || null } : { ok: false, error: String(res.data?.error?.code || res.data?.error?.message || `relay_${res.status}`).slice(0, 200) };
}

// → { candidates, sent, failed, list: [{ name, listing, views, contacts, sent, channel }] }
export async function sendViewsAdvice(country, { send = true, now = Date.now() } = {}) {
  const db = dbFor(country);
  const site = countryInfo(country).site;
  const extra = await internalEmails(country).catch(() => new Set());
  const listings = await selectAll(db, 'properties', 'select=id,created_by,created_at,status,admin_status,property_type,neighborhood,city&origin=eq.user&admin_status=eq.active&order=id.asc').catch(() => []);
  const ids = listings.map((l) => String(l.id));
  const views = await viewsFor(country, ids, ADVICE.days);
  const hot = ids.filter((id) => (views.get(id) || 0) >= ADVICE.minViews);
  if (!hot.length) return { candidates: 0, sent: 0, failed: 0, list: [] };
  const since = new Date(now - ADVICE.days * D).toISOString();
  const owners = inList([...new Set(listings.filter((l) => hot.includes(String(l.id))).map((l) => l.created_by))]);
  const [clicks, recent, users, approved] = await Promise.all([
    db.select('contact_link_clicks', `select=property_id&property_id=${inList(hot)}&created_at=gte.${enc(since)}&limit=10000`).catch(() => []),
    db.select('email_log', `select=dedupe_key&automation_id=eq.${ADVICE_ID}&created_at=gte.${enc(new Date(now - ADVICE.repeatDays * D).toISOString())}&limit=5000`).catch(() => []),
    // phone + opt-out for WhatsApp; a DB without those columns still gets the emails
    db.select('users', `select=id,email,full_name,active,blocked,suspended,phone,whatsapp_opted_out_at&id=${owners}`)
      .catch(() => db.select('users', `select=id,email,full_name,active,blocked,suspended&id=${owners}`))
      .catch(() => []),
    whatsappReady(country),
  ]);
  const contacts = new Map();
  for (const c of clicks) contacts.set(String(c.property_id), (contacts.get(String(c.property_id)) || 0) + 1);
  const picks = pickAdvice({
    listings, views, contacts, now,
    users: new Map(users.map((u) => [String(u.id), u])),
    recentlyAdvised: new Set(recent.map((r) => listingOfKey(r.dedupe_key)).filter(Boolean)),
    isInternal: (e) => isInternalEmail(e, extra),
  });
  const testTo = String(process.env.MANAGER_WHATSAPP_TO || '').trim();
  const planOf = (p) => adviceChannel({ ...p, country, approved, testTo });
  const out = { candidates: picks.length, sent: 0, failed: 0, list: [] };
  if (!send) { out.list = picks.map((p) => ({ name: p.user.full_name || p.user.email, listing: p.listing.id, views: p.views, contacts: p.contacts, sent: false, channel: planOf(p).channel })); return out; }
  const day = new Date(now).toISOString().slice(0, 10);
  for (const p of picks) {
    const key = `mviews:${p.listing.id}:${day}`;
    const via = planOf(p);
    if (via.channel === 'email' && !p.user.email) continue;   // only a phone, WhatsApp not available yet
    const meta = { listing: p.listing.id, user: p.user.id, views: p.views, contacts: p.contacts };
    const wa = via.channel === 'whatsapp' ? { to_phone: via.to, template_key: ADVICE_WA } : {};
    // claim first (unique dedupe_key) so two runs can't both send it
    try {
      await db.insert('email_log', [{ automation_id: ADVICE_ID, channel: via.channel, to_email: p.user.email, ...wa, subject: 'views-no-contacts', status: 'sending', dedupe_key: key, error: JSON.stringify(meta) }], { returning: 'minimal' });
    } catch { continue; }   // already sent today
    let patch = null;
    if (via.channel === 'whatsapp') {
      const r = await sendWhatsApp(via, p, key);
      if (r.ok) patch = { status: 'sent', subject: `WhatsApp · ${ADVICE_WA}`, relay_message_id: r.id };
      else meta.wa_error = r.error;   // → the email instead, same row
    }
    if (!patch) {
      const m = adviceEmail({ ...p, site });
      const r = await sendManagerEmail({ country, to: p.user.email, subject: m.subject, html: m.html, text: m.text }).catch((e) => ({ ok: false, error: String(e?.message || e) }));
      patch = { status: r.ok ? 'sent' : 'failed', channel: 'email', subject: m.subject.slice(0, 200), resend_id: r.id || null, ...(meta.wa_error ? { error: JSON.stringify(meta), to_phone: null, template_key: null } : {}) };
    }
    await db.update('email_log', `dedupe_key=eq.${enc(key)}`, patch, { returning: 'minimal' }).catch(() => {});
    const ok = patch.status === 'sent';
    if (ok) out.sent++; else out.failed++;
    out.list.push({ name: p.user.full_name || p.user.email, listing: p.listing.id, views: p.views, contacts: p.contacts, sent: ok, channel: patch.channel || 'whatsapp' });
  }
  return out;
}
