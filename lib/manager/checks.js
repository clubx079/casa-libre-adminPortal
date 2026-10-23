// Admin Manager — checks the code does BEFORE Claude reads anything, so the report never
// takes a complaint, a bot or a bad listing at face value:
//   claimChecks   — every low rating / payment claim of the last 30 days, next to what the
//                   records say about that person (payments, drafts, listings, every email
//                   and WhatsApp we sent them, logins). "I paid but nothing appeared" with no
//                   payment on record and an unfinished draft = a likely false flag.
//   suspicious    — bots (Google Play's pre-launch robot and similar) in feedback and sign-ups,
//                   and live owner listings with data that cannot be right (a rent at a sale
//                   price, an address that is not an address …).
//   messageTiming — per automation and channel: delivered / bounced / opened / clicked
//                   (email, from Resend) or delivered / read (WhatsApp, from Relay), by the
//                   hour it went out, and how long people took to act after it.
// Pure (the data pack fetches, these only compute) — test/managerChecks.test.js.
import { botReason } from '../feedbackBot.js';

const H = 3600 * 1000;
const t = (v) => Date.parse(v);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

// ── claims ──────────────────────────────────────────────────────────────────

// Says they paid / were charged / want money back.
const PAYMENT_CLAIM = /\b(pagu[eé]|pag[oó]|pagado|pagamos|cobr|tarjeta|bancard|transferen|reembols|devoluci|comprobante|factura|d[eé]bito)|(₲|G\.?\s?\d|gs\.?\s?\d|us\$|\$\s?\d)/i;
export const isPaymentClaim = (message) => PAYMENT_CLAIM.test(String(message || ''));

// One feedback row + the records about its person → the facts the report must weigh.
// ctx: { user (or null), payments [], drafts [], listings [], messages [] (email_log rows to them) }
export function claimFacts(fb, ctx) {
  const { user = null, payments = [], drafts = [], listings = [], messages = [] } = ctx || {};
  const at = t(fb.created_at);
  const paid = payments.filter((p) => ['paid', 'succeeded', 'complete', 'completed'].includes(String(p.status).toLowerCase()));
  const facts = {
    feedback_id: fb.id,
    user_id: user?.id || fb.user_id || null,
    rating: fb.rating,
    at: fb.created_at,
    message: String(fb.message || '').slice(0, 600),
    claimsPayment: isPaymentClaim(fb.message),
    account: user ? { signed_up: user.created_at, last_login: user.last_login_at || null, how: user.auth_provider || null } : null,
    paymentsOnRecord: payments.map((p) => ({ status: p.status, amount_usd: p.amount_usd, kind: p.kind, plan: p.plan, at: p.created_at })),
    paidPayments: paid.length,
    drafts: drafts.map((d) => ({ started: d.created_at, last_edit: d.updated_at, finished: false })),
    listings: listings.map((l) => ({ id: l.id, status: l.admin_status, delisted: l.is_delisted, at: l.created_at })),
    messagesWeSent: messages.map((m) => ({ automation: m.automation_id, channel: m.channel || 'email', status: m.status, at: m.created_at })),
    cameBackAfterMessage: !!(user?.last_login_at && messages.some((m) => t(user.last_login_at) > t(m.created_at))),
  };
  // what the records say, in plain words (the agent still decides)
  const signals = [];
  if (facts.claimsPayment && !paid.length) signals.push('says they paid, but there is no completed payment on record for this person');
  if (facts.claimsPayment && /bancard/i.test(facts.message)) signals.push('mentions Bancard, which Casa Libre does not use (payments go through Stripe)');
  const amount = /G\.?\s?([\d.]{5,})/i.exec(facts.message);
  if (amount) signals.push(`mentions ${amount[0]} (about US$${Math.round(Number(amount[1].replace(/\./g, '')) / 7800)}), not one of our prices (US$5.80 listing, US$5 extension / Verified, US$20 Landing)`);
  if (drafts.length && !listings.length) signals.push('has an unfinished listing draft and no published listing (never reached the payment step)');
  if (!user) signals.push('no account with this email');
  const reminder = messages.find((m) => m.automation_id === 'draft_reminders' && t(m.created_at) > at);
  if (reminder) signals.push(`got the unfinished-draft reminder on ${reminder.created_at.slice(0, 10)}${facts.cameBackAfterMessage ? ' and signed in again after it, but still did not finish' : ''}`);
  facts.signals = signals;
  facts.likelyFalseFlag = facts.claimsPayment && !paid.length && (drafts.length > 0 || !listings.length);
  return facts;
}

// ── bots and impossible listing data ───────────────────────────────────────

export const botFeedback = (rows = []) => rows
  .map((r) => ({ r, reason: botReason(r) }))
  .filter((x) => x.reason)
  .map(({ r, reason }) => ({ feedback_id: r.id, rating: r.rating, name: r.name || null, source: r.source || null, at: r.created_at, reason }));

export const botAccounts = (users = []) => users
  .map((u) => ({ u, reason: botReason({ email: u.email, name: u.full_name, user_id: null }) }))
  .filter((x) => x.reason)
  .map(({ u, reason }) => ({ user_id: u.id, signed_up: u.created_at, reason }));

// What's wrong with one owner listing's data (empty list = looks fine).
export function listingDataFlags(l) {
  const flags = [];
  const usd = Number(l.price_usd) || null;
  const addr = String(l.address || '').trim();
  const hood = String(l.neighborhood || '').trim();
  const desc = String(l.description || '').trim();
  if (l.listing_type === 'rent' && usd && usd > 15000) flags.push(`listed for RENT at about US$${Math.round(usd).toLocaleString('en-US')} a month: a sale price (rent vs sale mixed up?)`);
  if (l.listing_type === 'sale' && usd && usd < 2000) flags.push(`listed for SALE at about US$${Math.round(usd)}: a rent price (sale vs rent mixed up?)`);
  if (!Number(l.price)) flags.push('no price');
  if (String(l.property_type || '').toLowerCase() === 'otro') flags.push('property type "Otro"');
  if (addr && hood && addr.toLowerCase() === hood.toLowerCase()) flags.push(`address and neighborhood are the same text ("${addr}")`);
  if (addr && addr.length < 6) flags.push(`address too short ("${addr}")`);
  if (desc.length < 40) flags.push(`description only ${desc.length} characters`);
  return flags;
}

// ── message timing ─────────────────────────────────────────────────────────

// Local hour (0–23) of an ISO time, for a UTC offset in hours (Paraguay -3).
export const localHour = (iso, offsetH) => (new Date(t(iso) + offsetH * H).getUTCHours());
export const HOUR_BUCKETS = [['00–06', 0, 6], ['06–12', 6, 12], ['12–18', 12, 18], ['18–24', 18, 24]];
const bucketOf = (h) => HOUR_BUCKETS.find(([, a, b]) => h >= a && h < b)[0];
export const DELAY_BUCKETS = [['under 1 h', 0, 1], ['1–6 h', 1, 6], ['6–24 h', 6, 24], ['1–3 days', 24, 72], ['3–7 days', 72, 168]];
const delayOf = (hours) => (DELAY_BUCKETS.find(([, a, b]) => hours >= a && hours < b) || [null])[0];

const ENGAGED = { delivered: 1, opened: 2, clicked: 3 };

// messages: email_log rows (automation_id, channel, status, to_email, created_at, resend_id,
// run_id); resend: Map resend_id → last_event; userByEmail: Map email → user;
// listings / payments: owner listings + payments (to time what people did next);
// drafts: Map draft id → { created_at } (draft reminders: how long the draft sat first).
export function messageTiming({ messages = [], resend = new Map(), userByEmail = new Map(), listings = [], payments = [], drafts = new Map(), offsetH = -3, now = Date.now() }) {
  const groups = new Map();
  const listedAt = new Map(); const paidAt = new Map();
  for (const l of listings) (listedAt.get(String(l.created_by)) || listedAt.set(String(l.created_by), []).get(String(l.created_by))).push(t(l.created_at));
  for (const p of payments) if (['paid', 'succeeded'].includes(String(p.status))) (paidAt.get(String(p.user_id)) || paidAt.set(String(p.user_id), []).get(String(p.user_id))).push(t(p.created_at));

  for (const m of messages) {
    if (['test', 'skipped', 'sending'].includes(String(m.status))) continue;
    const channel = m.channel === 'whatsapp' ? 'whatsapp' : 'email';
    const key = `${m.automation_id}|${channel}`;
    const g = groups.get(key) || groups.set(key, {
      automation: m.automation_id, channel, sent: 0, delivered: 0, bounced: 0, opened: 0, clicked: 0, read: 0, failed: 0, statusKnown: 0,
      byHour: Object.fromEntries(HOUR_BUCKETS.map(([b]) => [b, { sent: 0, engaged: 0 }])),
      actedAfter: Object.fromEntries(DELAY_BUCKETS.map(([b]) => [b, 0])), acted: 0, matured: 0,
      draftAgeAtReminderH: [],
    }).get(key);
    g.sent += 1;
    const hour = bucketOf(localHour(m.created_at, offsetH));
    g.byHour[hour].sent += 1;
    let engaged = false;
    if (channel === 'email') {
      const ev = String(resend.get(m.resend_id) || '').toLowerCase();
      if (ev) g.statusKnown += 1;
      if (ev === 'bounced' || ev === 'complained') g.bounced += 1;
      if (m.status === 'failed') g.failed += 1;
      if ((ENGAGED[ev] || 0) >= 1) g.delivered += 1;
      if ((ENGAGED[ev] || 0) >= 2) g.opened += 1;
      if (ev === 'clicked') { g.clicked += 1; engaged = true; }
    } else {
      g.statusKnown += 1;
      if (m.status === 'failed') g.failed += 1;
      if (['delivered', 'read'].includes(m.status)) g.delivered += 1;
      if (m.status === 'read') { g.read += 1; engaged = true; }
    }
    if (engaged) g.byHour[hour].engaged += 1;
    // what the person did next (listing or payment), within 7 days
    const sentAt = t(m.created_at);
    if (now - sentAt >= 7 * 24 * H) g.matured += 1;
    const u = userByEmail.get(String(m.to_email || '').toLowerCase());
    if (u) {
      const next = [...(listedAt.get(String(u.id)) || []), ...(paidAt.get(String(u.id)) || [])].filter((x) => x > sentAt && x - sentAt < 7 * 24 * H).sort((a, b) => a - b)[0];
      if (next) { g.acted += 1; g.actedAfter[delayOf((next - sentAt) / H)] += 1; }
    }
    if (m.automation_id === 'draft_reminders' && drafts.get(String(m.run_id))) {
      g.draftAgeAtReminderH.push(Math.round((sentAt - t(drafts.get(String(m.run_id)).created_at)) / H));
    }
  }

  return [...groups.values()].sort((a, b) => b.sent - a.sent).map((g) => {
    const out = {
      automation: g.automation, channel: g.channel, sent: g.sent, failed: g.failed,
      ...(g.channel === 'email'
        ? { delivered: g.delivered, bounced: g.bounced, opened: g.opened, clicked: g.clicked, bounceRate: pct(g.bounced, g.statusKnown), openRate: pct(g.opened, g.delivered), clickRate: pct(g.clicked, g.delivered), withTracking: g.statusKnown }
        : { delivered: g.delivered, read: g.read, readRate: pct(g.read, g.delivered) }),
      bySendHourLocal: Object.entries(g.byHour).filter(([, v]) => v.sent).map(([hours, v]) => ({ hours, sent: v.sent, [g.channel === 'email' ? 'clicked' : 'read']: v.engaged, rate: pct(v.engaged, v.sent) })),
      actedWithin7Days: g.acted,
      actedAfter: Object.fromEntries(Object.entries(g.actedAfter).filter(([, n]) => n)),
      messagesWithFull7Days: g.matured,
    };
    if (g.draftAgeAtReminderH.length) {
      const s = [...g.draftAgeAtReminderH].sort((a, b) => a - b);
      out.draftAgeWhenRemindedHours = { median: s[Math.floor(s.length / 2)], min: s[0], max: s[s.length - 1] };
    }
    return out;
  });
}
