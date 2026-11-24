// Security watch (lib/securityWatchRun.js) — call hourly with `Authorization: Bearer
// {{secrets.CRON_SECRET}}` (AiroBase Cron "0 * * * *"). ?country=<code> (default py), ?dry=1 →
// decide and report only. Suspends new accounts from a blocked region or a scraper-like IP and
// emails them; the admin keeps or lifts each one in Open issues.
// Also emails the team every NEW alert of the Alerts page once (lib/alertNotifyRun.js) — so new
// needs-a-person / CARTERA / PROYECTO alerts reach the team even when nobody has the admin open.
// And, when due, starts writing this week's newsletter edition (lib/newsletterEditionRun.js: only
// with Automations -> Weekly newsletter -> Auto-generate on, a few hours before the weekly email;
// once per week; runs in the background).
import { NextResponse } from 'next/server';
import { runSecurityWatch } from '@/lib/securityWatchRun';
import { forgetIssues } from '@/lib/openIssuesStore';
import { loadAlerts } from '@/lib/alertsData';
import { notifyNewAlerts } from '@/lib/alertNotifyRun';
import { startEditionIfDue } from '@/lib/newsletterEditionRun';

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
    const dry = sp.get('dry') === '1';
    if (dry) globalThis.__clAlertNotifyDry = true;
    const alertEmails = await loadAlerts(country, { fresh: true })
      .then((d) => notifyNewAlerts(country, d.alerts, { dryRun: dry }))
      .catch((e) => ({ error: String(e?.message || e).slice(0, 200) }))
      .finally(() => { if (dry) globalThis.__clAlertNotifyDry = false; });
    const newsletterEdition = dry ? { skipped: 'dry' } : await startEditionIfDue(country).catch((e) => ({ error: String(e?.message || e).slice(0, 200) }));
    return NextResponse.json({ ok: true, ...r, alertEmails, newsletterEdition });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
