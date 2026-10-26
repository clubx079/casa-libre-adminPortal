// Admin Manager — pure maths behind the weekly data pack (lib/manager/dataPack.js fetches,
// this file counts). No I/O — test/managerPackMath.test.js.

import { abandonedCheckouts } from '../checkouts.js';

const DAY = 86400000;

// Reports run Monday, Wednesday and Friday. A report covers the time since the last scheduled
// report ended (`since`): Mon → Fri–Mon (3 days), Wed → Mon–Wed, Fri → Wed–Fri (2 days).
// "previous" is the window of the SAME length just before it, so every number compares fairly.
// No earlier report, one more than 8 days back (a missed run) or less than 12 hours back (a
// rerun) → the last 7 days. `matured` = messages sent 7–14 days ago: they have had their full
// 7 days to work, whatever the period length (the fair follow-up scorecard).
export const MIN_PERIOD_MS = 12 * 3600 * 1000;
export const MAX_PERIOD_DAYS = 8;
export function periods(now = new Date(), since = null) {
  const end = new Date(now).getTime();
  let start = since ? Date.parse(since) : NaN;
  if (!Number.isFinite(start) || start > end - MIN_PERIOD_MS || start < end - MAX_PERIOD_DAYS * DAY) start = end - 7 * DAY;
  const len = end - start;
  const iso = (t) => new Date(t).toISOString();
  return {
    cur: { start: iso(start), end: iso(end) },
    prev: { start: iso(start - len), end: iso(start) },
    matured: { start: iso(end - 14 * DAY), end: iso(end - 7 * DAY) },
    days: Math.round((len / DAY) * 10) / 10,
  };
}

export const inPeriod = (when, p) => {
  const t = Date.parse(when);
  return Number.isFinite(t) && t >= Date.parse(p.start) && t < Date.parse(p.end);
};

// % change, rounded; null when there is nothing to compare with.
export function change(cur, prev) {
  const c = Number(cur) || 0, p = Number(prev) || 0;
  if (!p) return c ? null : 0;
  return Math.round(((c - p) / p) * 1000) / 10;
}

// { key: count } of the rows, biggest first, at most `top` keys (the rest → "other").
export function countBy(rows = [], keyFn, top = 12) {
  const m = new Map();
  for (const r of rows) {
    const k = String(keyFn(r) ?? '').trim() || '(none)';
    m.set(k, (m.get(k) || 0) + 1);
  }
  const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
  const out = Object.fromEntries(sorted.slice(0, top));
  const rest = sorted.slice(top).reduce((s, [, n]) => s + n, 0);
  if (rest) out.other = (out.other || 0) + rest;
  return out;
}

export const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);

// email_log statuses that mean "it went out" (email: sent; WhatsApp: sent → delivered → read).
const WENT_OUT = new Set(['sent', 'delivered', 'read', 'opened', 'clicked']);

// Which follow-up works. For every automation message (email_log) sent in `period`, did the
// person do something within `windowDays`?
//   listed  — published a listing (properties.origin = user)
//   paid    — a successful payment
//   active  — signed in again (users.last_login_at, latest only: a lower bound)
// messages: email_log rows; users: [{ id, email, last_login_at }]; listings: [{ created_by,
// created_at }]; payments: [{ user_id, status, created_at }].
// → rows per automation + template + channel, most sent first.
export function followUpResults({ messages = [], users = [], listings = [], payments = [], period, windowDays = 7, now = Date.now() }) {
  const byEmail = new Map(users.filter((u) => u.email).map((u) => [String(u.email).toLowerCase(), u]));
  const listedAt = new Map(); // user id → sorted listing times
  for (const l of listings) {
    const k = String(l.created_by || '');
    if (!k) continue;
    if (!listedAt.has(k)) listedAt.set(k, []);
    listedAt.get(k).push(Date.parse(l.created_at));
  }
  const paidAt = new Map();
  for (const p of payments) {
    if (p.status !== 'succeeded') continue;
    const k = String(p.user_id || '');
    if (!paidAt.has(k)) paidAt.set(k, []);
    paidAt.get(k).push(Date.parse(p.created_at));
  }
  const within = (times = [], t0) => times.some((t) => t > t0 && t <= t0 + windowDays * DAY);

  const groups = new Map();
  for (const m of messages) {
    if (!inPeriod(m.created_at, period)) continue;
    const st = String(m.status || '').toLowerCase();
    if (st === 'test' || st === 'skipped') continue;
    const channel = m.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const automation = m.automation_id || 'one-off';
    const template = m.template_key || String(m.subject || '').replace(/^WhatsApp\s*·\s*/i, '').slice(0, 60) || '—';
    const key = `${automation}|${template}|${channel}`;
    if (!groups.has(key)) groups.set(key, { automation, template, channel, sent: 0, failed: 0, read: 0, people: new Set(), matched: 0, listed: 0, paid: 0, active: 0, stillOpen: 0 });
    const g = groups.get(key);
    if (WENT_OUT.has(st)) g.sent += 1; else if (st === 'failed' || st === 'bounced') { g.failed += 1; continue; } else continue;
    if (st === 'read') g.read += 1;
    const t0 = Date.parse(m.created_at);
    if (t0 + windowDays * DAY > now) g.stillOpen += 1;
    const u = byEmail.get(String(m.to_email || '').toLowerCase());
    if (!u) continue;
    if (g.people.has(u.id)) continue;      // one person counts once per group
    g.people.add(u.id);
    g.matched += 1;
    if (within(listedAt.get(String(u.id)), t0)) g.listed += 1;
    if (within(paidAt.get(String(u.id)), t0)) g.paid += 1;
    const login = Date.parse(u.last_login_at);
    if (Number.isFinite(login) && login > t0) g.active += 1;
  }
  return [...groups.values()]
    .map(({ people, ...g }) => ({
      ...g,
      people: people.size,
      listedRate: pct(g.listed, g.matched),
      paidRate: pct(g.paid, g.matched),
      activeRate: pct(g.active, g.matched),
      readRate: g.channel === 'whatsapp' ? pct(g.read, g.sent) : null,
    }))
    .sort((a, b) => b.sent - a.sent);
}

// Feedback rows → summary for the pack: average, how many low (1–2 stars), and the texts.
export function feedbackSummary(rows = []) {
  const rated = rows.filter((r) => Number(r.rating) > 0);
  const avg = rated.length ? Math.round((rated.reduce((s, r) => s + Number(r.rating), 0) / rated.length) * 10) / 10 : null;
  return {
    count: rows.length,
    avgRating: avg,
    low: rated.filter((r) => Number(r.rating) <= 2).length,
    byRating: countBy(rated, (r) => `${r.rating}★`, 5),
  };
}

// Sign-ups in a period, split by how they signed up.
export function signupSummary(users = [], period) {
  const mine = users.filter((u) => inPeriod(u.created_at, period));
  return {
    total: mine.length,
    verified: mine.filter((u) => u.verified === true).length,
    byMethod: countBy(mine, (u) => u.auth_provider || 'email', 8),
  };
}

// New owner listings in a period: how many, what kind, where.
export function listingSummary(listings = [], period) {
  const mine = listings.filter((l) => inPeriod(l.created_at, period));
  const sellers = new Set(mine.map((l) => l.created_by).filter(Boolean));
  return {
    total: mine.length,
    sellers: sellers.size,
    byOperation: countBy(mine, (l) => l.listing_type, 6),
    byType: countBy(mine, (l) => l.property_type, 10),
    byCity: countBy(mine, (l) => l.city, 10),
    byStatus: countBy(mine, (l) => [l.status, l.admin_status].filter(Boolean).join(' / '), 8),
    incomplete: mine.filter((l) => l.is_complete === false).length,
    promoted: mine.filter((l) => l.promotion_plan).length,
  };
}

// Payments in a period: succeeded / failed, money, by product, and abandoned checkouts:
// a 'started' row (the card form opened — buyer site lib/billing.js recordCheckoutStarted)
// with no 'succeeded' row for the same Stripe PaymentIntent, at least an hour old.
export function paymentSummary(payments = [], period, now = Date.now()) {
  const { started: starts, abandoned } = abandonedCheckouts(payments, { now, from: period.start, to: period.end });
  const mine = payments.filter((p) => inPeriod(p.created_at, period) && p.kind !== 'listing_free' && p.status !== 'started');
  const ok = mine.filter((p) => p.status === 'succeeded');
  return {
    succeeded: ok.length,
    failed: mine.filter((p) => p.status === 'failed').length,
    other: mine.filter((p) => !['succeeded', 'failed'].includes(p.status)).length,
    revenueUsd: Math.round(ok.reduce((s, p) => s + (Number(p.amount_usd) || 0), 0) * 100) / 100,
    byProduct: countBy(ok, (p) => [p.kind, p.plan].filter(Boolean).join(' · '), 8),
    failures: mine.filter((p) => p.status === 'failed').slice(0, 10).map((p) => ({ user_id: p.user_id, property_id: p.property_id, kind: p.kind, amount_usd: p.amount_usd, reason: p.failure_reason, at: p.created_at })),
    checkoutsStarted: starts.length,
    checkoutsAbandoned: abandoned.length,
    abandonedCheckouts: abandoned.slice(0, 10).map((p) => ({ user_id: p.user_id, property_id: p.property_id, kind: p.kind, plan: p.plan || null, amount_usd: p.amount_usd, at: p.created_at })),
  };
}

// Scrape runs per source over the last days: runs, failures, new / updated listings.
export function scraperHealth(sources = [], runs = []) {
  const bySource = new Map();
  for (const r of runs) {
    const k = String(r.source_id);
    if (!bySource.has(k)) bySource.set(k, []);
    bySource.get(k).push(r);
  }
  return sources.map((s) => {
    const rs = (bySource.get(String(s.id)) || []).sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at));
    const sum = (k) => rs.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    return {
      key: s.key, name: s.name, active: s.is_active, cron: s.cron_enabled,
      runs: rs.length,
      failed: rs.filter((r) => /fail|error/i.test(String(r.status))).length,
      inserted: sum('inserted_count'), updated: sum('updated_count'),
      lastRun: rs[0]?.started_at || s.last_run_at || null,
      lastStatus: rs[0]?.status || s.last_run_status || null,
    };
  }).sort((a, b) => (b.active === a.active ? b.runs - a.runs : b.active ? 1 : -1));
}
