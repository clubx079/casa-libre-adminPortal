// Weekly Admin Manager report. Called by AiroBase Cron every Monday 07:00 Paraguay time
// (cron "0 10 * * 1" UTC) with `Authorization: Bearer {{secrets.CRON_SECRET}}`.
// ?country=<code> (default py). Starts the run and answers at once; the report appears
// on /manager when it is done (a few minutes). A cron call within 5 days of the last
// cron report is skipped, so a retried or doubled call doesn't pay twice.
import { NextResponse } from 'next/server';
import { dbFor } from '@/lib/db';
import { TABLE, startRun } from '@/lib/manager/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY not set' }, { status: 500 });
  const country = (new URL(req.url).searchParams.get('country') || 'py').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  try {
    const since = new Date(Date.now() - 5 * 86400000).toISOString();
    const [recent] = await dbFor(country).select(TABLE, `select=id,created_at&trigger=eq.cron&status=in.(running,done)&country=eq.${country}&created_at=gte.${encodeURIComponent(since)}&limit=1`);
    if (recent) return NextResponse.json({ ok: true, skipped: 'A weekly report was already made in the last 5 days.', id: recent.id });
    const res = await startRun(country, { trigger: 'cron', by: 'cron' });
    return NextResponse.json(res, { status: res.ok ? 202 : 409 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
