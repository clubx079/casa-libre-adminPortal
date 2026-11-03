// Loads what lib/waSignins.js matches, for the active country: the batches' recipient phones,
// the accounts active since the first batch, and who came from a batch's link signed in
// (PostHog). Read-only. Kept 1 minute.
import 'server-only';
import { dbFor } from './db.js';
import { activeCountry } from './adminCountry.js';
import { selectAll } from './selectAll.js';
import { hogql, posthogConfigured } from './posthogHogql.js';
import { isInternalEmail } from './internalTraffic.js';
import { HIDE_DELETED_USERS } from './userInsights.js';
import { matchSignins } from './waSignins.js';
import { recipientRef } from './waCampaigns.js';

const SAFE = /^wc-[a-z0-9-]+$/;
const USER_COLS = 'id,full_name,email,phone,created_at,last_login_at,phone_verified_at,attribution';
const cache = new Map();

// campaigns → { signins: Map campaign id → [signed-in user …] (each with listings published since
// the send), landed: Map campaign id → people who landed on the website from the batch's link }
// Landed = PostHog people with a page view tagged utm_campaign = the batch (the "WhatsApp
// campaign" source on Analytics), after the send.
export async function batchSignins(campaigns = []) {
  const live = campaigns.filter((c) => !c.demo && c.state !== 'draft');
  if (!live.length) return { signins: new Map(), landed: new Map() };
  const cc = activeCountry();
  const key = `${cc}:${live.map((c) => c.id).join(',')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit.data;

  const db = dbFor(cc);
  const since = new Date(Math.min(...live.map((c) => Date.parse(c.sent_at || c.created_at) || Date.now()))).toISOString();
  const ids = live.map((c) => c.id).join(',');
  const slugs = live.map((c) => c.slug).filter((s) => SAFE.test(String(s || '')));

  const [recipients, active, landed] = await Promise.all([
    selectAll(db, 'email_log', `select=run_id,to_phone,error&automation_id=eq.wa_campaign&channel=eq.whatsapp&run_id=in.(${ids})&order=id.asc`),
    selectAll(db, 'users', `select=${USER_COLS}&${HIDE_DELETED_USERS}&or=(created_at.gte.${since},last_login_at.gte.${since},phone_verified_at.gte.${since})&order=created_at.asc`),
    slugs.length && posthogConfigured()
      ? hogql(`SELECT toString(properties.utm_campaign) AS slug, any(person.properties.email) AS email, min(timestamp) AS t FROM events
          WHERE event = '$pageview' AND properties.utm_campaign IN (${slugs.map((s) => `'${s}'`).join(',')}) AND timestamp >= now() - INTERVAL 120 DAY
          GROUP BY slug, person_id`, { fresh: 60_000, stale: 0 }).catch(() => [])
      : [],
  ]);
  // + people who came from a formula SÍ link (utm_medium mensaje, utm_term = their person code)
  const byCode = posthogConfigured() ? await hogql(`SELECT toString(properties.utm_term) AS ref, any(person.properties.email) AS email, min(timestamp) AS t FROM events
      WHERE event = '$pageview' AND lower(coalesce(properties.utm_medium, '')) = 'mensaje' AND coalesce(properties.utm_term, '') != '' AND timestamp >= now() - INTERVAL 120 DAY
      GROUP BY ref, person_id`, { fresh: 60_000, stale: 0 }).catch(() => []) : [];
  const allLanded = [
    ...(landed || []).map(([slug, email, at]) => ({ slug, email: String(email || '').toLowerCase(), at })),
    ...(byCode || []).map(([ref, email, at]) => ({ slug: '', ref, email: String(email || '').toLowerCase(), at })),
  ];
  const landedRows = allLanded.filter((l) => l.email.includes('@'));
  // people who came from a link already signed in (their last sign-in can be older than the batch)
  const known = new Set(active.map((u) => String(u.email || '').toLowerCase()));
  const missing = [...new Set(landedRows.map((l) => l.email).filter((e) => !known.has(e)))];
  const more = missing.length
    ? await db.select('users', `select=${USER_COLS}&${HIDE_DELETED_USERS}&email=in.(${missing.map((e) => `"${e.replace(/"/g, '')}"`).map(encodeURIComponent).join(',')})`).catch(() => [])
    : [];
  const users = [...active, ...more].filter((u) => !isInternalEmail(u.email));

  const matched = matchSignins({
    campaigns: live,
    recipients: recipients.map((r) => { let m = {}; try { m = JSON.parse(r.error || '{}') || {}; } catch {} return { run_id: r.run_id, phone: r.to_phone, ref: recipientRef(m.key || r.to_phone) }; }),
    users,
    landed: landedRows,
  });

  // what they did next: listings published since the batch
  const uids = [...new Set([...matched.values()].flat().map((s) => s.user_id))];
  const props = uids.length
    ? await selectAll(db, 'properties', `select=created_by,created_at&origin=eq.user&created_by=in.(${uids.join(',')})&order=id.asc`).catch(() => [])
    : [];
  for (const c of live) {
    const sent = Date.parse(c.sent_at || c.created_at) || 0;
    for (const s of matched.get(String(c.id)) || []) {
      s.listings = props.filter((p) => String(p.created_by) === String(s.user_id) && Date.parse(p.created_at) >= sent).length;
    }
  }
  const landedBy = new Map(live.map((c) => {
    const sent = Date.parse(c.sent_at || c.created_at) || 0;
    const codes = new Set(recipients.filter((r) => String(r.run_id) === String(c.id)).map((r) => { let m = {}; try { m = JSON.parse(r.error || '{}') || {}; } catch {} return recipientRef(m.key || r.to_phone); }));
    return [String(c.id), allLanded.filter((l) => (l.slug === c.slug || (l.ref && codes.has(l.ref))) && Date.parse(l.at) >= sent - 60_000).length];
  }));
  const data = { signins: matched, landed: landedBy };
  cache.set(key, { at: Date.now(), data });
  return data;
}
