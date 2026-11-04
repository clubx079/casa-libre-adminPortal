// POST /api/relay/webhook — Relay's events for the admin (relay.airosofts.com → Developers &
// API → Webhooks → a second endpoint pointing here; the website keeps its own for ticks, opt-outs
// and the campaign buttons). Signed with HMAC-SHA256 (Relay-Signature: t=…,v1=…; secret
// RELAY_WEBHOOK_SECRET = this endpoint's whsec_…).
//   message.inbound → the Inbox assistant (lib/inboxAuto.js): robots / emojis / thanks are
//     ignored, buttons and keywords are the website's, a real question gets an automatic answer
//     when it is a fact we hold, anything else is tagged "needs-a-person" for the team (Open issues).
// Anything else is acknowledged and ignored.
import { NextResponse } from 'next/server';
import { verifyRelaySignature } from '@/lib/relaySignature';
import { handleInbound } from '@/lib/inboxAuto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(req) {
  const raw = await req.text();
  if (!verifyRelaySignature(raw, req.headers.get('relay-signature'), process.env.RELAY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: 'bad_signature' }, { status: 401 });
  }
  let evt;
  try { evt = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }); }
  const type = String(evt?.type || '');
  if (type !== 'message.inbound') return NextResponse.json({ ok: true, ignored: type });
  // our own signed dry-run tests wait for the answer (they read it back)
  if (evt.dry === true) {
    try { return NextResponse.json({ ok: true, ...(await handleInbound(evt.data || {}, { dryRun: true })) }); }
    catch (e) { return NextResponse.json({ ok: true, action: 'error', reason: String(e?.message || e).slice(0, 200) }); }
  }
  // Relay wants a 2xx within 10 s and retries otherwise; sorting + answering takes longer. So:
  // answer at once and do the work in the background (a long-running server, not serverless).
  // The same message arriving again while it is being handled (a retry) is dropped here; after
  // that, the email_log row (dedupe ai:<message id>) and the send's Idempotency-Key stop it.
  const id = String(evt.data?.id || '');
  if (id && inFlight.has(id)) return NextResponse.json({ ok: true, queued: false, reason: 'already_in_progress' }, { status: 202 });
  if (id) inFlight.add(id);
  handleInbound(evt.data || {}, { dryRun: false })
    .then((r) => { if (r?.action && !['ignored', 'website', 'skipped', 'off'].includes(r.action)) console.log('[inbox-ai]', id, r.action, r.reason || ''); })
    .catch((e) => console.error('[inbox-ai]', id, String(e?.message || e).slice(0, 200)))
    .finally(() => { if (id) setTimeout(() => inFlight.delete(id), 10 * 60 * 1000); });
  return NextResponse.json({ ok: true, queued: true }, { status: 202 });
}

// message ids being handled right now on this server (Relay retries within minutes)
const inFlight = (globalThis.__clInboxInFlight ||= new Set());
