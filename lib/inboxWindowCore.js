// The Inbox assistant uses WhatsApp's free 24-hour window to sell — the pure rules (no fetch,
// no DB). lib/inboxAuto.js (sales reply) and lib/inboxWindow.js (window-closing follow-up) do
// the work. test/inboxWindow.test.js.
//
// 1. SALES REPLY. A message that is not a question ("gracias", "ok", "excelente", a heart) still
//    gets ONE short sales reply — at most one such reply per 24 hours per conversation (so
//    "gracias → reply → gracias" never loops). Real questions are answered as before.
// 2. WINDOW FOLLOW-UP. The window closes 24 h after their LAST message. About 3 hours before it
//    closes, if they have not done the goal action since the window opened, ONE closing sales
//    message — at most one per window (a window = its last inbound message, the dedupe key).
//    Goal already done → nothing.
// Never (both): Do-not-contact, opted out (BAJA / STOP), they asked us to stop or said they are
// not interested, a team member is handling the chat (needs-a-person tag, or a team member wrote
// in this window), robots only (agency auto-greetings), off-topic only, or button taps only
// (SÍ / CARTERA / PROYECTO — the website already answered those in this window).
import { isTeamReply, isRealReply } from './inboxAutoRules.js';

export const HOUR = 3600000;
export const WINDOW_MS = 24 * HOUR;
export const FOLLOWUP_BEFORE_MS = 3 * HOUR;          // send when the window closes in 3 h or less…
export const FOLLOWUP_LAST_MS = 15 * 60000;          // …but not in its last 15 minutes
export const SALE_EVERY_MS = 24 * HOUR;              // at most one sales reply per 24 h per chat
export const SALE_KINDS = new Set(['ack', 'emoji']); // what gets a sales reply instead of an answer
export const PERSON_KINDS = new Set(['ack', 'emoji', 'greeting', 'media', 'question', 'text']);
export const WEBSITE_KINDS = new Set(['button', 'keyword']);
export const NEEDS_PERSON = 'needs-a-person';
export const DNC = 'do-not-contact';

// The tracked links' reply code (lib/aiLinks.js → website /r/ai ?a= → utm_content): a sales reply
// starts with "ack", a window follow-up with "win", so Analytics tells them apart.
export const saleRef = (answer) => `ack${String(answer || '').replace(/[^a-z0-9]/gi, '').toLowerCase()}`.slice(0, 24);
export const windowRef = (answer) => `win${String(answer || '').replace(/[^a-z0-9]/gi, '').toLowerCase()}`.slice(0, 24);
export const saleKey = (inboundId) => `aisale:${inboundId}`;
export const windowKey = (phone, lastInboundId) => `aiwin:${String(phone || '').replace(/\D/g, '')}:${lastInboundId}`;

const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0) || 0;
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// They told us to stop, or that they're not interested (any language we see often).
const STOP = /\b((?<!planta )baja|stop|unsubscribe|no me (escrib|mand|envi|molest|contact)\w*|no (me )?(manden|envien|mandes|envies|escriban|escribas) mas|dejen de (escribir|mandar|enviar)|deja de (escribir|mandar|enviar)|no molest\w*|no quiero (recibir|mas|que me)|borr\w* mi (numero|contacto)|no (me )?interesa\w*|no estoy interesad\w*|not interested|don ?t (text|message|write|contact) me|para de escribir)\b/;
export const asksToStop = (text) => STOP.test(fold(text));

// The window as the messages show it: its last inbound message, when it opened (the first inbound
// of the run where no gap between their messages is longer than 24 h) and when it closes (Relay's
// window.expires_at when it gives one, else 24 h after their last message).
export function windowOf(messages = [], conv = null, now = Date.now()) {
  const inbound = messages.filter((m) => m?.direction === 'inbound' && t(m)).sort((a, b) => t(a) - t(b));
  const last = inbound[inbound.length - 1];
  if (!last) return null;
  let first = last;
  for (let i = inbound.length - 2; i >= 0; i--) {
    if (t(first) - t(inbound[i]) > WINDOW_MS) break;
    first = inbound[i];
  }
  const fromRelay = Date.parse(conv?.window?.expires_at || '');
  const closesAt = Number.isFinite(fromRelay) && fromRelay >= t(last) ? fromRelay : t(last) + WINDOW_MS;
  return { lastInbound: last, openedAt: t(first), closesAt, open: closesAt > now, inbound: inbound.filter((m) => t(m) >= t(first)) };
}

// Conversations worth a look for the follow-up: their last message 21–23¾ h ago (from Relay's list).
export function dueConversations(list = [], { now = Date.now() } = {}) {
  return (list || []).filter((c) => {
    const last = Date.parse(c?.last_inbound_at || '');
    if (!Number.isFinite(last) || !String(c?.phone || '').replace(/\D/g, '')) return false;
    const closes = Date.parse(c?.window?.expires_at || '') || last + WINDOW_MS;
    const left = closes - now;
    return left > FOLLOWUP_LAST_MS && left <= FOLLOWUP_BEFORE_MS;
  });
}

// What blocks any automatic sales message in this conversation (or null).
//   conv: Relay conversation; messages: its messages; since: the window's opening time;
//   user: { whatsapp_opted_out_at } when we know their account
//   aiIds: Relay ids of the assistant's own messages (email_log). A typed message from us that is
//   not one of them was written by a team member — in WhatsApp, or in our admin Inbox (which Relay
//   marks sent_by 'api' like the assistant). Without aiIds only WhatsApp-side team replies count.
export const teamWrote = (m, aiIds = null) => isTeamReply(m) || (!!aiIds && isRealReply(m) && !aiIds.has(String(m.id)));
export function salesBlocked({ conv = null, messages = [], since = 0, user = null, aiIds = null } = {}) {
  const tags = conv?.tags || [];
  if (tags.includes(DNC)) return 'do_not_contact';
  if (String(conv?.opt_in_status || '').toLowerCase() === 'opted_out' || user?.whatsapp_opted_out_at) return 'opted_out';
  if (messages.some((m) => m?.direction === 'inbound' && asksToStop(m.text))) return 'asked_to_stop';
  if (tags.includes(NEEDS_PERSON)) return 'team_handling';
  if (messages.some((m) => t(m) >= since && teamWrote(m, aiIds))) return 'team_handling';
  return null;
}

// Rule 1 — a "gracias" / reaction: send the one sales reply?
//   kinds: Map(message id → kind) of the window's inbound messages (button taps included)
//   lastSaleAt: when the last sales reply went to this number (ISO / ms) or null
export function decideSale({ kind, conv = null, messages = [], kinds = new Map(), lastSaleAt = null, user = null, aiIds = null, now = Date.now() }) {
  if (!SALE_KINDS.has(kind)) return { ok: false, reason: 'not_a_thanks' };
  const w = windowOf(messages, conv, now);
  const since = w?.openedAt ?? now - WINDOW_MS;
  const blocked = salesBlocked({ conv, messages, since, user, aiIds });
  if (blocked) return { ok: false, reason: blocked };
  const last = lastSaleAt ? (typeof lastSaleAt === 'number' ? lastSaleAt : Date.parse(lastSaleAt)) : 0;
  if (last && now - last < SALE_EVERY_MS) return { ok: false, reason: 'sale_already_sent' };
  // a SÍ / CARTERA / PROYECTO tap in this window: the website answered it — no second answer
  if ((w?.inbound || []).some((m) => WEBSITE_KINDS.has(kinds.get(String(m.id))))) return { ok: false, reason: 'website_answered' };
  return { ok: true, reason: null, window: w };
}

// Rule 2 — the window-closing follow-up: send it now?
//   kinds: Map(message id → kind) for the window's inbound messages; sent: dedupe keys already used
//   goalDone: they did the goal action since the window opened (null = unknown → treated as not done)
export function decideFollowUp({ conv = null, messages = [], kinds = new Map(), sent = new Set(), user = null, aiIds = null, goalDone = null, now = Date.now() }) {
  const w = windowOf(messages, conv, now);
  if (!w || !w.open) return { ok: false, reason: 'window_closed' };
  const left = w.closesAt - now;
  if (left > FOLLOWUP_BEFORE_MS) return { ok: false, reason: 'not_due' };
  if (left <= FOLLOWUP_LAST_MS) return { ok: false, reason: 'too_late' };
  const key = windowKey(conv?.phone, w.lastInbound.id);
  if (sent.has(key)) return { ok: false, reason: 'already_sent', key };
  const blocked = salesBlocked({ conv, messages, since: w.openedAt, user, aiIds });
  if (blocked) return { ok: false, reason: blocked, key };
  const ks = w.inbound.map((m) => kinds.get(String(m.id)) || 'text');
  if (!ks.some((k) => PERSON_KINDS.has(k))) {
    if (ks.some((k) => WEBSITE_KINDS.has(k))) return { ok: false, reason: 'website_answered', key };
    if (ks.some((k) => k === 'offtopic')) return { ok: false, reason: 'offtopic', key };
    return { ok: false, reason: 'robot_only', key };
  }
  if (goalDone) return { ok: false, reason: 'goal_done', key };
  return { ok: true, reason: null, key, window: w };
}

// The goal for their situation (lib/aiFacts.js situationOf) — what the message pushes, and what
// counts as done. → { goal, push }
export function goalFor(situation = '') {
  const s = String(situation);
  if (/sign-up code|not a Casa Libre account/i.test(s)) return { goal: 'sign_up', push: 'create their account now ("No esperes, creá tu cuenta") — links.sign_in_or_sign_up' };
  if (/waiting for payment/i.test(s)) return { goal: 'pay', push: 'finish the payment of the listing waiting for payment — that listing\'s pay_link' };
  if (/photos rejected/i.test(s)) return { goal: 'fix_listing', push: 'change the rejected photos so the listing goes live — that listing\'s fix_link' };
  if (/draft/i.test(s)) return { goal: 'finish_draft', push: 'finish the draft and publish it — the draft\'s continue_link' };
  if (/NOT listed any property/i.test(s)) return { goal: 'publish', push: 'publish their first property, free — links.publish_a_property' };
  return { goal: 'publish', push: 'their listing is live: get the Verified badge (links.my_listings), publish another property (links.publish_a_property) or share their listing\'s link — pick ONE' };
}

// Did they act since the window opened? rows from our DB (only theirs):
//   user { created_at }, listings [{ created_at, updated_at, status }], payments [{ status, created_at }]
export function goalDoneSince({ goal, since, user = null, listings = [], payments = [] }) {
  const after = (v) => Date.parse(v || 0) >= since;
  const newListing = listings.some((p) => after(p.created_at) && !['rejected', 'payment_pending'].includes(p.status));
  const paid = payments.some((x) => x.status === 'succeeded' && after(x.created_at));
  switch (goal) {
    case 'sign_up': return !!(user && after(user.created_at));
    case 'pay': return paid;
    case 'fix_listing': return listings.some((p) => after(p.updated_at) && p.status !== 'rejected');
    case 'finish_draft':
    case 'publish': return newListing || paid;
    default: return newListing || paid;
  }
}
