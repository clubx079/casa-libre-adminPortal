// Open issues — the daily run (every 24 h). AiroBase Cron "0 10 * * *" (07:00 Paraguay) with
// `Authorization: Bearer {{secrets.CRON_SECRET}}`, one call per country (?country=py|bo|uy|ve, default py).
// Every day, in this order:
//   1. the Admin Manager's personal follow-ups (lib/manager/daily.js): first payment emails,
//      payment reminders, listing-fix reminders — skipped if already done in the last 20 h
//      (the Mon / Wed / Fri report runs them too);
//   2. the views-but-no-contacts advice (lib/manager/viewsAdviceRun.js): WhatsApp when we have
//      the number and the template is approved, else email; once per listing in 30 days;
//   3. today's Open issues list (lib/openIssuesStore.js getDayIssues) — Admin Manager → Open
//      issues → today's date. Re-running the same day replaces it.
// The weekly report itself keeps its own cron (Mon / Wed / Fri, /api/cron/manager).
import { NextResponse } from 'next/server';
import { getDayIssues } from '@/lib/openIssuesStore';
import { runDailyFollowups } from '@/lib/manager/daily';
import { sendViewsAdvice } from '@/lib/manager/viewsAdviceRun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const autoSend = () => process.env.MANAGER_AUTO_SEND !== '0';

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const country = (new URL(req.url).searchParams.get('country') || 'py').toLowerCase();
  if (!/^[a-z]{2}$/.test(country)) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  try {
    const followups = await runDailyFollowups(country).catch((e) => ({ ok: false, error: String(e?.message || e).slice(0, 200) }));
    const advice = autoSend() ? await sendViewsAdvice(country).catch((e) => ({ error: String(e?.message || e).slice(0, 200) })) : { skipped: true };
    const r = await getDayIssues(country, { fresh: true });
    return NextResponse.json({ ok: true, country, day: r.day, counts: r.counts, chats: r.sources?.chats ?? null, followups, advice });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
