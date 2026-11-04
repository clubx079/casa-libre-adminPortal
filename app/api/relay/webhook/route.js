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
  try {
    const r = await handleInbound(evt.data || {}, { dryRun: evt.dry === true });   // dry: only our own signed test events carry it
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ ok: true, action: 'error', reason: String(e?.message || e).slice(0, 200) });
  }
}
