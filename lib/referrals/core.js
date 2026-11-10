// Referral program — the pure rules, shared word-for-word with the admin portal
// (casa-libre-adminPortal lib/referrals/core.js is an identical copy).
//
// A verified user shares their link (/ref/<code>). Someone who arrives through it,
// creates an account (any sign-in method) and publishes a listing that goes live
// (photos checked, not a held duplicate) is a QUALIFIED referral, unless they look like
// the same person as the referrer (lib/samePerson.js rules). Then:
//   · the new person: their listing gets `newUser.plan` (Verified) for `newUser.days`
//   · the referrer:   one of their listings gets `referrer.plan` for `referrer.days`
//   · every `milestone.every` qualified referrals (3): one listing gets `milestone.plan`
//     (Verified + home page) for `milestone.days` — once, or each time when `repeat`.
// Rewards are ordinary promotions (properties.promotion_plan / promotion_expires_at), so
// the badge, home strip, map pin and expiry behave exactly like a paid one.
//
// Settings: the `automations` row 'referrals' (one per country DB) — `enabled` and
// `free_tiers[0]` = the settings object below. No table of its own.
// Records: email_log rows (channel 'event', dedupe key "…:ev", which every email page
// already leaves out) — see lib/referrals/store.js.
import crypto from 'node:crypto';

export const REFERRALS_ID = 'referrals';
export const PLANS = ['verified', 'home'];
export const DAY = 86400000;

export const DEFAULTS = Object.freeze({
  attributionDays: 30,                                  // first click → sign-up window
  referrer: { enabled: true, plan: 'verified', days: 30 },
  newUser: { enabled: true, plan: 'verified', days: 30 },
  milestone: { enabled: true, every: 3, plan: 'home', days: 30, repeat: false },
  remindDays: [3, 1],                                   // reminder emails, days before the end
  maxRewardsPerReferrer: 0,                             // 0 = no limit on rewarded referrals
  requireReferrerListing: false,                        // invite only people with a live listing
  inviteChannel: 'email',                               // 'email' | 'whatsapp' | 'both'
  inviteWaTemplate: '',                                 // approved Relay template for the invite
  shareText: 'Publicá tu propiedad gratis en Casa-Libre, el nuevo marketplace inmobiliario de {{country}}: los interesados te escriben directo a tu WhatsApp y no cobramos comisión. Si publicás con mi link, tu publicación sale Verificada gratis por {{new_user_days}} días: {{link}}',
});

// The email templates the program uses, by fixed key (admin → Templates edits the text).
export const TEMPLATE_KEYS = Object.freeze({
  invite: 'referral-invite',
  referrer: 'referral-reward-referrer',
  newUser: 'referral-reward-new',
  milestone: 'referral-milestone',
  ending: 'referral-ending',
});

const int = (v, min, max, d) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };
const plan = (v, d) => (PLANS.includes(v) ? v : d);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

function reward(src = {}, d) {
  return { enabled: bool(src?.enabled, d.enabled), plan: plan(src?.plan, d.plan), days: int(src?.days, 1, 365, d.days) };
}

// automations row → the settings, with every gap filled from DEFAULTS.
export function referralConfig(row) {
  const s = (Array.isArray(row?.free_tiers) ? row.free_tiers[0] : row?.free_tiers) || {};
  const steps = Array.isArray(s.remindDays) ? [...new Set(s.remindDays.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 60))].sort((a, b) => b - a) : null;
  return {
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    exists: !!row,
    attributionDays: int(s.attributionDays, 1, 365, DEFAULTS.attributionDays),
    referrer: reward(s.referrer, DEFAULTS.referrer),
    newUser: reward(s.newUser, DEFAULTS.newUser),
    milestone: { ...reward(s.milestone, DEFAULTS.milestone), every: int(s.milestone?.every, 1, 100, DEFAULTS.milestone.every), repeat: bool(s.milestone?.repeat, DEFAULTS.milestone.repeat) },
    remindDays: steps && steps.length ? steps.slice(0, 5) : [...DEFAULTS.remindDays],
    maxRewardsPerReferrer: int(s.maxRewardsPerReferrer, 0, 10000, DEFAULTS.maxRewardsPerReferrer),
    requireReferrerListing: bool(s.requireReferrerListing, DEFAULTS.requireReferrerListing),
    inviteChannel: ['email', 'whatsapp', 'both'].includes(s.inviteChannel) ? s.inviteChannel : DEFAULTS.inviteChannel,
    inviteWaTemplate: typeof s.inviteWaTemplate === 'string' ? s.inviteWaTemplate.trim().slice(0, 80) : '',
    shareText: typeof s.shareText === 'string' && s.shareText.trim() ? s.shareText.trim().slice(0, 600) : DEFAULTS.shareText,
  };
}

// ── Codes ────────────────────────────────────────────────────────────────────────
// Each user's code is derived from their id (same id → same code in every place), 8
// letters/digits without look-alikes (no 0/o, 1/l/i). Stored once so a code finds its owner.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export function codeFor(userId) {
  const h = crypto.createHash('sha256').update(`cl-ref:${String(userId)}`).digest();
  let out = '';
  for (let i = 0; i < 8; i++) out += ALPHABET[h[i] % ALPHABET.length];
  return out;
}
export const isCode = (s) => typeof s === 'string' && /^[a-hjkmnp-z2-9]{8}$/.test(s);
export const referralUrl = (site, code) => `${String(site || '').replace(/\/$/, '')}/ref/${code}`;

// ── The visitor's referral cookie (first touch: never overwritten while valid) ───────
export const REF_COOKIE = 'cl_ref';
export const VISITOR_COOKIE = 'cl_rv';
export const makeRefCookie = (code, nowMs = Date.now()) => JSON.stringify({ c: code, t: nowMs });
export function parseRefCookie(raw, nowMs = Date.now(), days = DEFAULTS.attributionDays) {
  if (!raw) return null;
  try {
    const v = JSON.parse(decodeURIComponent(raw));
    if (!isCode(v?.c) || !Number.isFinite(v?.t)) return null;
    if (nowMs - v.t > days * DAY || v.t > nowMs + 5 * 60000) return null;
    return { code: v.c, clickedAt: v.t };
  } catch { return null; }
}

// "New" for a referral: the account was created after the first click (a minute of
// clock slack), or in the last 30 minutes (a sign-up finishing now). An account that
// existed before the person ever clicked is never a referral.
export function isNewForReferral(user, clickedAtMs, nowMs = Date.now()) {
  const t = Date.parse(user?.created_at);
  if (!Number.isFinite(t)) return false;
  return t >= clickedAtMs - 60000 || nowMs - t <= 30 * 60000;
}

// ── People, shown privately: first name + last initial, never the contact details ───
export function maskName(fullName, email) {
  const parts = String(fullName || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length) return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.` : parts[0];
  const local = String(email || '').split('@')[0];
  return local ? `${local.slice(0, 2)}***` : '—';
}

// ── Listings ─────────────────────────────────────────────────────────────────────
// Live = on the site: passed the photo check (published), not held (duplicate review,
// payment pending, rejected), active and complete.
export const isLive = (p) => !!p && p.status === 'published' && p.admin_status === 'active' && p.is_complete !== false && p.is_delisted !== true;

// Why a person's listing doesn't count yet (shown to the referrer + admin).
export function listingHold(listings = []) {
  if (!listings.length) return 'no_listing';
  const s = new Set(listings.map((p) => p.status));
  if (s.has('scanning')) return 'checking_photos';
  if (s.has('payment_pending')) return 'payment_pending';
  if (s.has('duplicate_review')) return 'duplicate';
  if (s.has('rejected')) return 'photos_rejected';
  return 'not_live';
}

const activePromo = (p, nowMs) => !!(p?.promotion_plan && p.promotion_expires_at && Date.parse(p.promotion_expires_at) > nowMs);
export const higherPlan = (a, b) => (a === 'home' || b === 'home' ? 'home' : a || b || 'verified');

// Which of a user's listings a reward goes on → { id, plan, extendFrom } | null.
//   1. the newest live listing with no promotion running
//   2. else (all promoted) the live listing whose promotion ends first: the days are
//      added after it, and a 'home' promotion is never turned back into 'verified'
// listings: [{ id, created_at, status, admin_status, is_complete, promotion_plan, promotion_expires_at }]
export function pickRewardListing(listings = [], rewardPlan, nowMs = Date.now()) {
  const live = listings.filter(isLive);
  if (!live.length) return null;
  const free = live.filter((p) => !activePromo(p, nowMs)).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  if (free.length) return { id: free[0].id, plan: rewardPlan, extendFrom: null };
  // a 'home' reward prefers a listing that is only Verified now (it moves up to the home page)
  const pool = rewardPlan === 'home' && live.some((p) => p.promotion_plan !== 'home') ? live.filter((p) => p.promotion_plan !== 'home') : live;
  const soonest = [...pool].sort((a, b) => Date.parse(a.promotion_expires_at) - Date.parse(b.promotion_expires_at))[0];
  return { id: soonest.id, plan: higherPlan(soonest.promotion_plan, rewardPlan), extendFrom: soonest.promotion_expires_at };
}

// The reward on ONE given listing (the new person's): same stacking rules.
export function rewardOnListing(p, rewardPlan, nowMs = Date.now()) {
  if (!isLive(p)) return null;
  return activePromo(p, nowMs)
    ? { id: p.id, plan: higherPlan(p.promotion_plan, rewardPlan), extendFrom: p.promotion_expires_at }
    : { id: p.id, plan: rewardPlan, extendFrom: null };
}

// Milestone rewards earned at `qualified` referrals: [1] at 3, and with repeat [1,2] at 6…
export function milestonesDue(qualified, cfg) {
  const m = cfg?.milestone;
  if (!m?.enabled || !m.every) return [];
  const n = Math.floor(Number(qualified || 0) / m.every);
  const k = m.repeat ? n : Math.min(n, 1);
  return Array.from({ length: k }, (_, i) => i + 1);
}

// Which reminder is due now: the step (days before the end) most recently reached, or
// null. Steps are sent once each; an older step that was missed is not sent late.
export function reminderDue(untilIso, steps = [], nowMs = Date.now()) {
  const until = Date.parse(untilIso);
  if (!Number.isFinite(until) || until <= nowMs) return null;
  const reached = steps.filter((d) => nowMs >= until - d * DAY);
  return reached.length ? Math.min(...reached) : null;
}

// Plain-language names, for the emails ({{reward_plan}}) and the pages.
export const PLAN_TEXT = { verified: 'la insignia Verificada', home: 'la insignia Verificada y la portada' };
export const REWARD_TYPES = ['new_user', 'referrer', 'milestone', 'manual'];

// Row helpers: each record keeps its details as JSON in email_log.error.
export function dataOf(row) {
  try { const v = JSON.parse(row?.error || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; }
}

// Counts for a referrer (dashboard + admin): clicks, sign-ups, listed, qualified, rewards.
export function summarize({ persons = [], rewards = [], clicks = 0 } = {}) {
  const st = (r) => r.subject;
  return {
    clicks,
    signups: persons.length,
    listed: persons.filter((p) => st(p) === 'qualified' || dataOf(p).listing_id).length,
    qualified: persons.filter((p) => st(p) === 'qualified').length,
    rejected: persons.filter((p) => st(p) === 'rejected').length,
    rewardsGranted: rewards.filter((r) => ['granted', 'expired'].includes(st(r))).length,
    rewardsPending: rewards.filter((r) => st(r) === 'pending').length,
  };
}
