// GET /api/cron/window — the Inbox assistant's window-closing follow-ups (lib/inboxWindow.js): every
// WhatsApp conversation whose free 24-hour window closes in the next 3 hours gets ONE closing
// sales message when the person hasn't done the goal action yet. The Inbox poller already runs
// this every 10 minutes; this route is for an AiroBase cron as a backup (e.g. every 15 minutes,
// "*/15 * * * *") with `Authorization: Bearer {{secrets.CRON_SECRET}}`. Safe to call any number of
// times: each window is claimed once in email_log.
// ?dry=1 → decide and write the messages, send nothing, log nothing.
import { NextResponse } from 'next/server';
import { runWindowFollowUps } from '@/lib/inboxWindow';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const dry = new URL(req.url).searchParams.get('dry') === '1';
  try {
    const res = await runWindowFollowUps({ dryRun: dry });
    // phones shortened in the answer (it can end up in cron logs)
    return NextResponse.json({ ...res, results: (res.results || []).map((r) => ({ ...r, phone: r.phone ? `…${String(r.phone).slice(-4)}` : undefined })) }, { status: res.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
