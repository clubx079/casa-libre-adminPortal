// The window-closing follow-up (lib/inboxWindowCore.js rule 2): WhatsApp lets us write freely for
// 24 hours after a person's last message. About 3 hours before that window closes, if they have
// not done the goal action since the window opened, the assistant sends ONE closing sales
// message (at most one per window). Run by the Inbox poller every 10 minutes (lib/inboxPoll.js)
// and by GET /api/cron/window. Every send is claimed in email_log first (automation 'inbox_ai',
// template_key 'ai_window', dedupe_key aiwin:<phone>:<their last message id>), so a restart, the
// cron and the poller together still send it once. Server only.
import 'server-only';
import { relay, phoneParam, inboxMode } from './relayInbox';
import { dbFor } from './db';
import { DEFAULT_COUNTRY } from './adminCountry';
import { allConversations, phonesBySite } from './inboxData';
import { phoneKey, threadForAi } from './inboxRules';
import { siteFor, loadFactSheet } from './aiContext';
import { answerRef } from './aiLinks';
import { ask, autoEnabled, windowKinds, accountOptOut, sendSales, AI_AUTOMATION, PERSON_AUTOMATION, WINDOW_TEMPLATE } from './inboxAuto';
import { dueConversations, decideFollowUp, goalFor, goalDoneSince, windowRef, windowOf } from './inboxWindowCore.js';

const enc = encodeURIComponent;
const digits = (p) => String(p || '').replace(/\D/g, '');
export const WINDOW_EVERY_MS = 10 * 60 * 1000;
const QUIET = new Set(['not_due', 'too_late', 'window_closed', 'already_sent']);

async function countryOf(conv) {
  const tagged = siteFor(conv, '');
  if (tagged) return tagged;
  const known = (await phonesBySite().catch(() => new Map())).get(phoneKey(conv?.phone));
  return known?.[0] || DEFAULT_COUNTRY;
}

// Their own rows since the window opened: did they do it? (read-only)
async function goalProgress(db, phone, since) {
  const tail = digits(phone).slice(-8);
  if (tail.length < 8) return { user: null, listings: [], payments: [] };
  const sinceIso = new Date(since).toISOString();
  const [user] = await db.select('users', `select=id,created_at&phone=ilike.${enc(`%${tail}%`)}&order=phone_verified_at.desc.nullslast&limit=1`).catch(() => []);
  if (!user) return { user: null, listings: [], payments: [] };
  const [listings, payments] = await Promise.all([
    db.select('properties', `select=id,status,created_at,updated_at&created_by=eq.${enc(user.id)}&origin=eq.user&or=(created_at.gte.${enc(sinceIso)},updated_at.gte.${enc(sinceIso)})&limit=50`)
      .catch(() => db.select('properties', `select=id,status,created_at&created_by=eq.${enc(user.id)}&origin=eq.user&created_at=gte.${enc(sinceIso)}&limit=50`).catch(() => [])),
    db.select('payments', `select=status,created_at&user_id=eq.${enc(user.id)}&created_at=gte.${enc(sinceIso)}&limit=50`).catch(() => []),
  ]);
  return { user, listings, payments };
}

// One conversation → { action, reason, ... }. conv = Relay's conversation (from the list or GET).
export async function followUpOne(conv, { R = relay, now = Date.now(), dryRun = false } = {}) {
  const phone = digits(conv?.phone);
  if (!phone) return { action: 'skipped', reason: 'no_phone' };
  const msgs = await R(inboxMode(), `/conversations/${phoneParam(phone)}/messages?limit=60`);
  if (!msgs.ok) return { phone, action: 'error', reason: 'relay_messages' };
  const list = msgs.data?.data || [];
  const w = windowOf(list, conv, now);
  if (!w?.open) return { phone, action: 'skipped', reason: 'window_closed' };
  const cc = await countryOf(conv);
  const db = dbFor(cc);
  // what we already sent (dedupe keys + the assistant's Relay ids, to tell team messages apart)
  const logRows = await db.select('email_log', `select=dedupe_key,relay_message_id&automation_id=in.(${AI_AUTOMATION},${PERSON_AUTOMATION})&to_phone=eq.${enc(`+${phone}`)}&order=created_at.desc&limit=200`).catch(() => null);
  if (!logRows) return { phone, action: 'error', reason: 'email_log_unreadable', country: cc };   // never send blind
  const sent = new Set(logRows.map((r) => r.dedupe_key).filter(Boolean));
  const aiIds = new Set(logRows.map((r) => r.relay_message_id).filter(Boolean).map(String));
  // cheap checks first (no AI, no reads of their account)
  const pre = decideFollowUp({ conv, messages: list, kinds: new Map(w.inbound.map((m) => [String(m.id), 'text'])), sent, aiIds, now });
  if (!pre.ok) return { phone, action: 'skipped', reason: pre.reason, country: cc };
  const [kinds, user] = await Promise.all([windowKinds(db, list), accountOptOut(db, phone)]);
  const ansRef = windowRef(answerRef(w.lastInbound.id));
  const facts = await loadFactSheet(phone, conv, cc, { answer: ansRef });
  const { goal, push } = goalFor(facts.situation);
  const progress = await goalProgress(db, phone, w.openedAt);
  const goalDone = goalDoneSince({ goal, since: w.openedAt, ...progress });
  const dec = decideFollowUp({ conv, messages: list, kinds, sent, user, aiIds, goalDone, now });
  if (!dec.ok) return { phone, action: 'skipped', reason: dec.reason, country: cc, goal };
  const thread = threadForAi([...list].sort((a, b) => Date.parse(a.timestamps?.created || 0) - Date.parse(b.timestamps?.created || 0)));
  let out;
  try { out = await ask(facts.site.country, thread, facts, conv, { mode: 'window', push, cc, ref: w.lastInbound.id }); } catch (e) { return { phone, action: 'error', reason: `claude: ${String(e?.message || e).slice(0, 120)}`, country: cc }; }
  if (!out.message || out.action !== 'send') return { phone, action: 'skipped', reason: 'no_message', country: cc };
  if (dryRun) return { phone, action: 'dry:window', country: cc, goal, message: out.message, english: out.english, situation: facts.situation };
  const meta = { inbound_id: w.lastInbound.id, answer_ref: ansRef, goal: out.goal !== 'none' ? out.goal : goal, mode: 'window', window_opened_at: new Date(w.openedAt).toISOString(), window_closes_at: new Date(w.closesAt).toISOString(), country: cc };
  const res = await sendSales({ R, db, phone, key: dec.key, templateKey: WINDOW_TEMPLATE, out, facts, meta });
  return { phone, ...res, country: cc, goal: meta.goal, ...(res.action === 'sent' ? { message: out.message } : {}) };
}

// Every conversation whose window closes in the next 3 hours. opts.list: Relay's conversations
// (else read, all pages); opts.R: a relay stand-in (tests). → { ok, looked, sent, results }
export async function runWindowFollowUps({ now = Date.now(), dryRun = false, list = null, R = relay } = {}) {
  if (!autoEnabled()) return { ok: true, off: true, looked: 0, sent: 0, results: [] };
  let convs = list;
  if (!convs) {
    try { convs = await allConversations(inboxMode(), { fresh: true }); } catch (e) { return { ok: false, error: String(e?.message || e).slice(0, 200) }; }
  }
  const due = dueConversations(convs, { now });
  const results = [];
  for (const c of due) {
    try { results.push(await followUpOne(c, { R, now, dryRun })); } catch (e) { results.push({ phone: digits(c.phone), action: 'error', reason: String(e?.message || e).slice(0, 160) }); }
  }
  return { ok: true, looked: due.length, sent: results.filter((r) => r.action === 'sent').length, results };
}

// Called by the poller each minute: runs at most every 10 minutes, never two at once.
export async function maybeRunWindowFollowUps() {
  const g = (globalThis.__clWindowRun ||= { at: 0, busy: false });
  if (g.busy || Date.now() - g.at < WINDOW_EVERY_MS) return null;
  g.busy = true; g.at = Date.now();
  try {
    const r = await runWindowFollowUps();
    for (const x of r.results || []) if (!QUIET.has(x.reason)) console.log('[inbox-window]', x.phone ? `…${String(x.phone).slice(-4)}` : '', x.action, x.reason || '');
    return r;
  } finally { g.busy = false; }
}
