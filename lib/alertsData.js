// Alerts — the data behind lib/alerts.js, for one country (the admin's active one).
//   chats       the cached conversation list (lib/inboxData.js, 4 s) → only the chats of this
//               country with an alert tag; messages are fetched for THOSE chats only, and reused
//               while the chat's last message hasn't changed (so the sidebar count stays cheap)
//   handovers   this country's email_log rows 'inbox_ai_person' for those numbers
//   state       "Mark handled" (who / when + a snapshot): the `automations` row 'alerts_state'
//               (free_tiers[0].alerts — no table of its own, no DB change)
//   names       the account's name when the number is a user of this country (cached 10 min)
// Everything is read on inboxMode() (live, or Relay's TEST chats with INBOX_RELAY_MODE=test).
// Server only.
import 'server-only';
import { dbFor } from './db';
import { swr, forget } from './swrCache';
import { relay, phoneParam, inboxMode } from './relayInbox';
import { conversationsWithCountry, forgetConversations } from './inboxData';
import { inSite, phoneKey } from './inboxRules';
import { HIDE_DELETED_USERS } from './userInsights';
import { toEnglishMany } from './issueTranslate';
import { buildAlerts, alertCounts, isAlertChat, alertSnapshot, TAG_OF } from './alerts';

export const ALERTS_STATE_ID = 'alerts_state';
const PERSON_AUTOMATION = 'inbox_ai_person';   // lib/inboxAuto.js (not imported: it loads the AI SDK)
const D = 86400000;
const meta = (row) => { try { return JSON.parse(row?.error || '{}') || {}; } catch { return {}; } };

// ── "Mark handled" ──
export async function readAlertsState(db) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${ALERTS_STATE_ID}&limit=1`).catch(() => []);
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return s.alerts && typeof s.alerts === 'object' ? s.alerts : {};
}
export async function writeAlertsState(db, id, patch) {
  const alerts = await readAlertsState(db);
  alerts[id] = { ...(alerts[id] || {}), ...patch, at: new Date().toISOString() };
  const cut = Date.now() - 30 * D;   // keep the last 30 days
  for (const [k, v] of Object.entries(alerts)) if (Date.parse(v?.at || 0) < cut) delete alerts[k];
  const [row] = await db.select('automations', `select=id&id=eq.${ALERTS_STATE_ID}&limit=1`);
  const p = { enabled: false, free_tiers: [{ alerts }], updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${ALERTS_STATE_ID}`, p, { returning: 'minimal' });
  else await db.insert('automations', [{ id: ALERTS_STATE_ID, wait_days: 0, ...p }], { returning: 'minimal' });
  return alerts[id];
}

// ── messages, only for the tagged chats; reused until the chat's last message changes ──
const msgCache = (globalThis.__clAlertMsgs ||= new Map());   // `${mode}:${digits}` → { key, at, messages }
const lastKey = (c) => String(c?.last_message?.id || c?.last_message?.created_at || c?.last_message_at || c?.updated_at || '');
async function messagesOf(mode, c) {
  const k = `${mode}:${String(c.phone || '').replace(/\D/g, '')}`;
  const key = lastKey(c);
  const hit = msgCache.get(k);
  if (hit && key && hit.key === key && Date.now() - hit.at < 10 * 60_000) return hit.messages;
  const r = await relay(mode, `/conversations/${phoneParam(c.phone)}/messages?limit=50`);
  if (!r.ok) return hit?.messages || [];
  const messages = r.data?.data || [];
  msgCache.set(k, { key, at: Date.now(), messages });
  if (msgCache.size > 2000) msgCache.delete(msgCache.keys().next().value);
  return messages;
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]).catch(() => null); } }));
  return out;
}

// The account names of this country (last 8 digits → { full_name, email }), cached 10 minutes.
const usersByPhone = (country) => swr(`alerts-users:${country}`, async () => {
  const rows = await dbFor(country).select('users', `select=full_name,email,phone&phone=not.is.null&${HIDE_DELETED_USERS}&limit=20000`).catch(() => []);
  const m = new Map();
  for (const u of rows) { const k = phoneKey(u.phone); if (k.length === 8 && !m.has(k)) m.set(k, { full_name: u.full_name || null, email: u.email || null }); }
  return m;
}, { fresh: 10 * 60_000, stale: 60 * 60_000 });

// The alerts of one country (names included; text left as written). Cached 15 s per mode.
async function compute(country) {
  const mode = inboxMode();
  const db = dbFor(country);
  const all = await conversationsWithCountry(mode);
  const tagged = all.filter((c) => inSite(c, country) && isAlertChat(c));
  // the hand-over rows only for the chats tagged needs-a-person (100 numbers per query)
  const phones = tagged.filter((c) => (c.tags || []).map((x) => String(x).toLowerCase()).includes(TAG_OF.person)).map((c) => `"+${String(c.phone || '').replace(/\D/g, '')}"`);
  const handoversOf = async () => {
    const rows = [];
    for (let i = 0; i < phones.length; i += 100) {
      rows.push(...await db.select('email_log', `select=to_phone,subject,error,created_at&automation_id=eq.${PERSON_AUTOMATION}&to_phone=in.(${encodeURIComponent(phones.slice(i, i + 100).join(','))})&order=created_at.desc&limit=1000`).catch(() => []));
    }
    return rows;
  };
  const [msgs, handoverRows, state, personByPhone] = await Promise.all([
    pool(tagged, 6, (c) => messagesOf(mode, c)),
    handoversOf(),
    readAlertsState(db).catch(() => ({})),
    usersByPhone(country).catch(() => new Map()),
  ]);
  const chats = tagged.map((c, k) => ({ ...c, messages: msgs[k] || [] }));
  const alerts = buildAlerts({ chats, handovers: handoverRows.map((r) => ({ ...r, meta: meta(r) })), state, personByPhone, now: Date.now() });
  return { country, mode, generatedAt: new Date().toISOString(), alerts, counts: alertCounts(alerts) };
}
const key = (country) => `alerts:${inboxMode()}:${country}`;
export const loadAlerts = (country, { fresh = false } = {}) => swr(key(country), () => compute(country), { fresh: 15_000, stale: 2 * 60_000, force: fresh });
export const forgetAlerts = (country) => forget(key(country));

// The sidebar badge: open alerts of this country (0 when Relay / the DB can't be read).
export async function openAlertCount(country) {
  try { return (await loadAlerts(country)).counts.open; } catch { return 0; }
}

// The page: the same list, what people wrote / our holding message / the draft in English.
export async function alertsForPage(country, { fresh = false } = {}) {
  const data = await loadAlerts(country, { fresh });
  const texts = [];
  for (const a of data.alerts) {
    texts.push(...(a.wrote || []), a.holding || '', a.reason || '');
    if (a.draft?.es && !a.draft.en) texts.push(a.draft.es);
  }
  const en = await toEnglishMany(texts).catch(() => new Map());
  const E = (s) => (s ? en.get(String(s).trim()) || s : s);
  return {
    ...data,
    alerts: data.alerts.map((a) => ({
      ...a,
      wroteEn: (a.wrote || []).map(E),
      holdingEn: E(a.holding),
      reason: E(a.reason),
      draft: a.draft ? { es: a.draft.es, en: a.draft.en || E(a.draft.es) } : null,
    })),
  };
}

// "Mark handled": remove the alert's tag in Relay and save who / when (+ a snapshot, so the card
// stays in "Handled" for 7 days). Only an OPEN alert of the current list. → { ok } | { ok:false, error }
export async function markHandled(country, id, by) {
  const data = await loadAlerts(country, { fresh: true });
  const a = data.alerts.find((x) => x.id === id);
  if (!a) return { ok: false, error: 'That alert is no longer on the list.' };
  if (a.status !== 'open') return { ok: false, error: 'That alert is already closed.' };
  const mode = inboxMode();
  const r = await relay(mode, `/conversations/${phoneParam(a.digits)}`, { method: 'PATCH', json: { remove_tags: [a.tag] } });
  if (!r.ok && r.status !== 404) return { ok: false, error: r.data?.error?.message || `Relay ${r.status}` };
  await writeAlertsState(dbFor(country), id, { state: 'handled', by: by || null, snapshot: alertSnapshot(a) });
  forgetConversations(mode);
  forgetAlerts(country);
  return { ok: true };
}
