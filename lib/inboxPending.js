// Server side of lib/inboxPendingCore.js: reads the latest messages of every unread / unresponded
// conversation from Relay and attaches .pending { unread, tail } to it, so the Inbox counts and the
// sidebar badge only count conversations where a person wrote. Read-only (never marks anything read).
// Cached per conversation until its last message or unread count changes, so after the first call
// only new activity is fetched. A conversation that could not be read in time keeps no .pending and
// is COUNTED (never hide a real message because Relay was slow).
import 'server-only';
import { relay, phoneParam } from './relayInbox';
import { pendingOf } from './inboxPendingCore';
import { isUnread, isUnresponded } from './inboxRules';

const cache = (globalThis.__clInboxPending ||= new Map());     // `${mode}:${phone}` → { sig, pending }
const inflight = (globalThis.__clInboxPendingFlight ||= new Map());
const sigOf = (c) => `${c?.last_message?.id || c?.last_message?.created_at || ''}|${Number(c?.unread_count) || 0}`;
const keyOf = (mode, c) => `${mode}:${String(c?.phone || '').replace(/\D/g, '')}`;

async function readOne(mode, c) {
  const key = keyOf(mode, c);
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const r = await relay(mode, `/conversations/${phoneParam(c.phone)}/messages?limit=30`);
    if (!r.ok) return;
    cache.set(key, { sig: sigOf(c), pending: pendingOf(c, r.data?.data || []) });
  })().catch(() => {}).finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function withPending(list = [], mode = 'live', { budgetMs = 9000, concurrency = 8 } = {}) {
  const todo = list.filter((c) => (Number(c?.unread_count) > 0 || isUnresponded(c) || isUnread(c)) && cache.get(keyOf(mode, c))?.sig !== sigOf(c));
  if (todo.length) {
    let i = 0;
    const work = Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (i < todo.length) await readOne(mode, todo[i++]);
    }));
    // what isn't read within the budget is counted this time and finishes in the background
    await Promise.race([work, new Promise((r) => setTimeout(r, budgetMs))]);
  }
  return list.map((c) => {
    const hit = cache.get(keyOf(mode, c));
    return hit && hit.sig === sigOf(c) ? { ...c, pending: hit.pending } : c;
  });
}
