// Referral records — no table of their own. Each is an email_log row with
// automation_id 'referrals', channel 'event' and a dedupe key ending in ':ev' (the
// convention for event records that are not messages: every email count and list in the
// admin leaves them out — lib/automationDb.js EMAIL_ONLY there). The unique dedupe_key
// makes every record exactly-once, which is what keeps referrals and rewards from
// counting twice:
//   kind (template_key)  dedupe_key                              run_id      to_email   subject
//   ref_code             ref:code:<user id>:ev                   owner       owner      the code
//   ref_click            ref:click:<code>:<visitor>:<day>:ev     owner       '-'        the code
//   ref_person           ref:person:<new user id>:ev             referrer    new user   signed_up | qualified | rejected
//   ref_reward           ref:reward:<type>:<key>:ev              who gets it them       pending | granted | expired | revoked
// The details of each live in `error` as JSON (core.js dataOf). One person can only be
// referred once (first link wins): the person key is unique per new user.
// Dependency-injected `db` ({ select, insert, update }) — the same PostgREST helpers as
// lib/db.js, or the in-memory stand-in in the tests. Shared with the admin (identical).
import { codeFor, dataOf, REFERRALS_ID } from './core.js';

export const KIND = { code: 'ref_code', click: 'ref_click', person: 'ref_person', reward: 'ref_reward' };
const q = (s) => encodeURIComponent(s);
const isDup = (e) => e?.status === 409 || e?.code === '23505';
const base = (kind, key) => ({ automation_id: REFERRALS_ID, channel: 'event', status: 'sent', template_key: kind, dedupe_key: `${key}:ev` });
const json = (o) => JSON.stringify(o);
const COLS = 'id,run_id,to_email,subject,error,dedupe_key,created_at';
const kindQ = (kind) => `automation_id=eq.${REFERRALS_ID}&template_key=eq.${kind}`;

// ── Codes ────────────────────────────────────────────────────────────────────────
// The user's code (created on first use). → code
export async function ensureCode(db, user) {
  const code = codeFor(user.id);
  try {
    await db.insert('email_log', [{ ...base(KIND.code, `ref:code:${user.id}`), run_id: user.id, to_email: user.email || '-', subject: code, error: json({ created_at: new Date().toISOString() }) }], { returning: 'minimal' });
  } catch (e) { if (!isDup(e)) throw e; }
  return code;
}
export async function codeOwner(db, code) {
  const [row] = await db.select('email_log', `select=run_id,to_email&${kindQ(KIND.code)}&subject=eq.${q(code)}&limit=1`);
  return row ? { userId: String(row.run_id), email: row.to_email } : null;
}

// ── Clicks: one per visitor per code per day ──────────────────────────────────────
export async function recordClick(db, { code, ownerId, visitor, now = new Date() }) {
  const day = now.toISOString().slice(0, 10);
  try {
    await db.insert('email_log', [{ ...base(KIND.click, `ref:click:${code}:${visitor}:${day}`), run_id: ownerId, to_email: '-', subject: code, error: json({ at: now.toISOString() }) }], { returning: 'minimal' });
    return 'counted';
  } catch (e) { if (isDup(e)) return 'duplicate'; throw e; }
}
export async function clickCount(db, code) {
  if (db.selectWithCount) {
    const r = await db.selectWithCount('email_log', `select=id&${kindQ(KIND.click)}&subject=eq.${q(code)}&limit=1`);
    return r.count || 0;
  }
  return (await db.select('email_log', `select=id&${kindQ(KIND.click)}&subject=eq.${q(code)}`)).length;
}

// ── People (who referred whom) ────────────────────────────────────────────────────
// Attach a new account to the referrer whose link it came through. → the row, or null
// when this person is already somebody's referral (first link wins).
export async function attachPerson(db, { referrerId, user, code, clickedAt, method, now = new Date() }) {
  try {
    const [row] = await db.insert('email_log', [{
      ...base(KIND.person, `ref:person:${user.id}`), run_id: referrerId, to_email: user.email || '-', subject: 'signed_up',
      error: json({ referred_id: String(user.id), referred_name: user.full_name || null, code, clicked_at: new Date(clickedAt).toISOString(), signed_up_at: now.toISOString(), method: method || null }),
    }]);
    return row;
  } catch (e) { if (isDup(e)) return null; throw e; }
}
export const personOf = async (db, referredId) => (await db.select('email_log', `select=${COLS}&dedupe_key=eq.${q(`ref:person:${referredId}:ev`)}&limit=1`))[0] || null;
export const personsOf = (db, referrerId) => db.select('email_log', `select=${COLS}&${kindQ(KIND.person)}&run_id=eq.${q(referrerId)}&order=created_at.desc&limit=1000`);
export const peopleIn = (db, state, limit = 500) => db.select('email_log', `select=${COLS}&${kindQ(KIND.person)}&subject=eq.${state}&order=created_at.asc&limit=${limit}`);

// Change a record: merge `patch` into its details, and move its state — only from
// `from` when given (so two runs can't both move it: the second gets null).
export async function updateRecord(db, row, { patch = {}, to, from } = {}) {
  const data = { ...dataOf(row), ...patch };
  const filter = `id=eq.${q(row.id)}${from ? `&subject=eq.${q(from)}` : ''}`;
  const res = await db.update('email_log', filter, { error: json(data), ...(to ? { subject: to } : {}) }, { returning: 'representation' });
  return Array.isArray(res) && res.length ? res[0] : null;
}

// ── Rewards ──────────────────────────────────────────────────────────────────────
// Create a reward once (the key makes it once-only). → row | null when it exists.
export async function createReward(db, { key, user, data, state = 'pending' }) {
  try {
    const [row] = await db.insert('email_log', [{ ...base(KIND.reward, `ref:reward:${key}`), run_id: user.id, to_email: user.email || '-', subject: state, error: json({ ...data, created_at: new Date().toISOString() }) }]);
    return row;
  } catch (e) { if (isDup(e)) return null; throw e; }
}
export const rewardsOf = (db, userId) => db.select('email_log', `select=${COLS}&${kindQ(KIND.reward)}&run_id=eq.${q(userId)}&order=created_at.desc&limit=500`);
export const rewardsIn = (db, states, limit = 1000) => db.select('email_log', `select=${COLS}&${kindQ(KIND.reward)}&subject=in.(${states.join(',')})&order=created_at.asc&limit=${limit}`);

// Listings whose promotion is CURRENTLY ending because of a referral reward (the reward's
// end = the listing's end): the paid "renew" reminder leaves those to the referral one.
export async function rewardEnds(db) {
  const rows = await rewardsIn(db, ['granted']);
  const out = new Map();
  for (const r of rows) { const d = dataOf(r); if (d.property_id && d.until) out.set(String(d.property_id), d.until); }
  return out;
}
