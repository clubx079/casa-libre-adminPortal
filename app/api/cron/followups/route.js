// Admin Manager — the daily follow-ups (lib/manager/daily.js): first "your payment didn't go
// through" emails, payment reminders and listing-fix reminders, every day. Called by AiroBase
// Cron daily at 08:00 Paraguay time (cron "0 11 * * *" UTC) with
// `Authorization: Bearer {{secrets.CRON_SECRET}}`; the weekly report (Mon / Wed / Fri, 07:00)
// also runs it when it is done, so on those days this call is skipped (done < 20 h ago).
// ?country=<code> (default py) · ?force=1 runs even if done in the last 20 hours.
import { NextResponse } from 'next/server';
import { runDailyFollowups } from '@/lib/manager/daily';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }
  const url = new URL(req.url);
  const country = (url.searchParams.get('country') || 'py').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  try {
    const res = await runDailyFollowups(country, { force: url.searchParams.get('force') === '1' });
    return NextResponse.json(res, { status: res.ok ? 200 : 500 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
