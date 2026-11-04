// The Inbox assistant without webhooks. The admin's Inbox page never needed one: it reads
// Relay's API (GET /conversations). The poller does the same every minute — the newest
// conversations, and for each one with a customer message in the last 15 minutes, that
// message goes to handleInbound(), exactly what the webhook (app/api/relay/webhook) would do.
// Started from instrumentation.js (production). INBOX_POLL=0 turns it off.
// Never answers twice: the same in-progress set as the webhook, the email_log row
// (dedupe ai:<message id>) and the send's Idempotency-Key — so webhook + poller can both run.
import 'server-only';
import { relay, phoneParam, inboxMode } from './relayInbox';
import { handleInbound } from './inboxAuto';
import { recentConversations, newestInbound, POLL_LOOKBACK_MS } from './inboxPollCore';

export const POLL_MS = 60 * 1000;
const inFlight = (globalThis.__clInboxInFlight ||= new Set());      // shared with the webhook route
const seen = (globalThis.__clInboxPollSeen ||= new Map());           // message id → when handed over
const QUIET = ['ignored', 'website', 'skipped', 'off'];

export async function pollInboxOnce({ now = Date.now() } = {}) {
  const r = await relay(inboxMode(), '/conversations?status=all&limit=50');   // newest activity first
  if (!r.ok) return { ok: false, error: r.data?.error?.message || `Relay ${r.status}` };
  const convs = recentConversations(r.data?.data || [], { now });
  let handed = 0;
  for (const c of convs) {
    const msgs = await relay(inboxMode(), `/conversations/${phoneParam(c.phone)}/messages?limit=10`);
    if (!msgs.ok) continue;
    const evt = newestInbound(c, msgs.data?.data || [], new Set([...seen.keys(), ...inFlight]), { now });
    if (!evt) continue;
    seen.set(evt.id, now);
    inFlight.add(evt.id);
    handed += 1;
    try {
      const res = await handleInbound(evt, { dryRun: false });
      if (res?.action && !QUIET.includes(res.action)) console.log('[inbox-poll]', evt.id, res.action, res.reason || '');
    } catch (e) {
      console.error('[inbox-poll]', evt.id, String(e?.message || e).slice(0, 200));
    } finally {
      setTimeout(() => inFlight.delete(evt.id), 10 * 60 * 1000).unref?.();
    }
  }
  for (const [id, t] of seen) if (now - t > 2 * POLL_LOOKBACK_MS) seen.delete(id);   // keep the set small
  return { ok: true, looked: convs.length, handed };
}

export function startInboxPoller() {
  if (globalThis.__clInboxPoller || String(process.env.INBOX_POLL || '1') === '0') return;
  let busy = false;
  const tick = async () => {
    if (busy) return;   // a slow round (several answers) never overlaps the next
    busy = true;
    try { const r = await pollInboxOnce(); if (!r.ok) console.error('[inbox-poll]', r.error); }
    catch (e) { console.error('[inbox-poll]', String(e?.message || e).slice(0, 200)); }
    finally { busy = false; }
  };
  globalThis.__clInboxPoller = setInterval(tick, POLL_MS);
  globalThis.__clInboxPoller.unref?.();
  setTimeout(tick, 15_000).unref?.();
  console.log('[inbox-poll] started: every 60 s');
}
