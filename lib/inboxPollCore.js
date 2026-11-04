// Which customer messages the Inbox poller hands to the assistant (pure, testable).
// Per conversation: only the NEWEST inbound message, when it came in during the lookback window
// and was not handed over already (the assistant's answer reads the whole thread, so earlier
// unanswered messages are covered by it, exactly as when the webhook delivers them one by one).

export const POLL_LOOKBACK_MS = 15 * 60 * 1000;

const at = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0; };
const digits = (p) => String(p || '').replace(/\D/g, '');

// conversations whose last inbound message is recent enough to look at
export function recentConversations(list = [], { now = Date.now(), lookbackMs = POLL_LOOKBACK_MS } = {}) {
  return (list || []).filter((c) => digits(c?.phone) && now - at(c?.last_inbound_at) <= lookbackMs);
}

// messages: the conversation's newest messages (any order). → the event the webhook would carry, or null
export function newestInbound(conv, messages = [], seen = new Set(), { now = Date.now(), lookbackMs = POLL_LOOKBACK_MS } = {}) {
  const inbound = (messages || [])
    .filter((m) => m?.direction === 'inbound' && m.id && now - at(m.timestamps?.created || m.created_at) <= lookbackMs)
    .sort((a, b) => at(b.timestamps?.created || b.created_at) - at(a.timestamps?.created || a.created_at));
  const m = inbound[0];
  if (!m || seen.has(m.id)) return null;
  return { ...m, from: `+${digits(conv.phone)}`, phone: digits(conv.phone) };
}
