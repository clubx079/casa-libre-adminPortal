// What a WhatsApp conversation is waiting on (admin → Inbox). Pure — test/inboxPending.test.js.
//   unread  the contact's newest `unread_count` messages (Relay's unread count covers them even when
//           our automatic answer went out after them: a SÍ tap stays "unread" under our reply)
//   tail    everything they sent since our last message (what "Unresponded" is about)
// Each message is sorted by lib/waInboundKind.js. Only a person writing counts as needing the team:
// a greeting, a question, any other text, a photo / audio, or a thanks. Button taps and typed
// SÍ / BAJA / CARTERA / PROYECTO (the website answers them), reactions, stickers, emoji-only
// messages and other businesses' robot replies are "automated" (Inbox → Automated).
import { inboundKind } from './waInboundKind';

export const NEEDS_REPLY = new Set(['greeting', 'media', 'question', 'text', 'ack', 'offtopic']);
// Short English names for the automated kinds (the chip on a conversation row).
export const AUTOMATED_LABEL = { button: 'Button tap', keyword: 'SÍ / BAJA typed', emoji: 'Reaction', auto: 'Robot reply' };

const ts = (m) => Date.parse(m?.timestamps?.created || m?.created_at || '') || 0;
const summary = (kinds, unknown = false) => ({ kinds: [...new Set(kinds)], real: unknown || kinds.some((k) => NEEDS_REPLY.has(k)), unknown });

// c: the conversation (unread_count), msgs: its messages NEWEST FIRST (Relay's order).
export function pendingOf(c, msgs = []) {
  const list = Array.isArray(msgs) ? msgs : [];
  const kindAt = (i) => {
    const m = list[i];
    const ours = list.slice(i + 1).find((x) => x?.direction !== 'inbound');
    const secs = ours && ts(m) && ts(ours) ? Math.round((ts(m) - ts(ours)) / 1000) : null;
    return inboundKind(m, { secondsAfterOurs: secs }).kind;
  };
  const inboundIdx = list.map((m, i) => (m?.direction === 'inbound' ? i : -1)).filter((i) => i >= 0);
  const n = Math.max(0, Number(c?.unread_count) || 0);
  const unreadIdx = inboundIdx.slice(0, n);
  const tailIdx = [];
  for (let i = 0; i < list.length && list[i]?.direction === 'inbound'; i++) tailIdx.push(i);
  return {
    // unread_count says there is something new but none of it was in the page we read → count it
    unread: summary(unreadIdx.map(kindAt), n > 0 && unreadIdx.length === 0),
    tail: summary(tailIdx.map(kindAt), c?.last_message?.direction === 'inbound' && tailIdx.length === 0),
  };
}

// The automated kinds waiting on a conversation, for its chip ("Button tap · Reaction").
export function automatedKinds(pending) {
  const all = [...(pending?.unread?.kinds || []), ...(pending?.tail?.kinds || [])];
  return [...new Set(all.filter((k) => AUTOMATED_LABEL[k]))];
}
