// The SEO pipeline on a timer (AiroBase Cron, `Authorization: Bearer {{secrets.CRON_SECRET}}`).
// ONE cron does everything:   ?job=all   once a day "0 9 * * *" (06:00 Paraguay)
//   → Google Trends, then Ads + Search Console + site search, then Decide, then Autopilot (applies the
//   best opportunities by itself, within daily caps), then the Improve check — and records the run
//   with its AI SEO report (Admin Manager → AI SEO; lib/seo/runLog.js).
//   Improve is safe daily: it compares the last 7 days with the 7 before, retires a page only after
//   4 weeks with no impressions and changes a title at most once per 14 days (lib/seo/settings.js).
// Single stages still work on their own (manual runs, not recorded): ?job=trends | collect | decide | autopilot | improve
// ?country=py|bo|uy|ve|sv|all (default all). Countries run side by side. Time budget (300 s): Autopilot
// stops at 120 s (the next run continues), then Improve, the snapshot and the report (Claude ≤ 90 s).
import { NextResponse } from 'next/server';
import { runPipeline, STEPS } from '@/lib/seo/runLog';
import { SEO_COUNTRIES } from '@/lib/seo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SINGLE = new Set(STEPS);

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const job = sp.get('job') || 'all';
  if (job !== 'all' && !SINGLE.has(job)) return NextResponse.json({ error: 'unknown job' }, { status: 400 });
  const c = (sp.get('country') || 'all').toLowerCase();
  const countries = c === 'all' ? SEO_COUNTRIES : SEO_COUNTRIES.includes(c) ? [c] : null;
  if (!countries) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  const deadline = Date.now() + 120000;
  const out = {};
  const work = Promise.all(countries.map(async (cc) => {
    try {
      out[cc] = job === 'all'
        ? await runPipeline(cc, { trigger: 'cron', deadline })
        : await runPipeline(cc, { trigger: `manual:${job}`, deadline, steps: [job], record: false });
    } catch (e) { out[cc] = { error: String(e?.message || e).slice(0, 300) }; }
  }));
  // answer at once and finish on the server (a proxy may close a long request); ?wait=1 = wait for results
  if (sp.get('wait') !== '1') {
    work.catch(() => {});
    return NextResponse.json({ ok: true, started: true, job, countries, at: new Date().toISOString(), note: 'running on the server; results appear in Admin Manager → AI SEO' }, { status: 202 });
  }
  await work;
  return NextResponse.json({ ok: true, job, at: new Date().toISOString(), results: out });
}

export const GET = handle;
export const POST = handle;
