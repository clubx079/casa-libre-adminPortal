// Security watch (lib/securityWatchRun.js) — call hourly with `Authorization: Bearer
// {{secrets.CRON_SECRET}}` (AiroBase Cron "0 * * * *"). ?country=<code> (default py), ?dry=1 →
// decide and report only. Suspends new accounts from a blocked region or a scraper-like IP and
// emails them; the admin keeps or lifts each one in Open issues.
import { NextResponse } from 'next/server';
import { runSecurityWatch } from '@/lib/securityWatchRun';
import { forgetIssues } from '@/lib/openIssuesStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const country = (sp.get('country') || 'py').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  try {
    const r = await runSecurityWatch(country, { dryRun: sp.get('dry') === '1' });
    if (r.suspended.length && !r.dryRun) forgetIssues(country);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
