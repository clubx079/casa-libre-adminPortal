// The SEO pipeline on a timer (AiroBase Cron, `Authorization: Bearer {{secrets.CRON_SECRET}}`).
// ONE cron does everything:   ?job=all   once a day "0 9 * * *" (06:00 Paraguay)
//   → Google Trends, then Ads + Search Console + site search, then Decide, then Autopilot (applies the
//   best opportunities by itself, within daily caps), then the Improve check.
//   Improve is safe daily: it compares the last 7 days with the 7 before, retires a page only after
//   4 weeks with no impressions and changes a title at most once per 14 days (lib/seo/settings.js).
// Single stages still work on their own (manual runs): ?job=trends | collect | decide | daily | improve
// ?country=py|bo|uy|ve|sv|all (default all). Answers with each country's result.
import { NextResponse } from 'next/server';
import { runCollect, runDecide, runImprove, runAutopilot } from '@/lib/seo/run';
import { SEO_COUNTRIES } from '@/lib/seo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const STEPS = {
  all: ['trends', 'collect', 'decide', 'autopilot', 'improve'],
  daily: ['collect', 'decide'],
  trends: ['trends'], collect: ['collect'], decide: ['decide'], autopilot: ['autopilot'], improve: ['improve'],
};

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const job = sp.get('job') || 'all';
  const steps = STEPS[job];
  if (!steps) return NextResponse.json({ error: 'unknown job' }, { status: 400 });
  const c = (sp.get('country') || 'all').toLowerCase();
  const countries = c === 'all' ? SEO_COUNTRIES : SEO_COUNTRIES.includes(c) ? [c] : null;
  if (!countries) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  // countries run side by side; Autopilot stops ~40 s before the 300 s limit and the next run continues
  const deadline = Date.now() + 255000;
  const out = {};
  await Promise.all(countries.map(async (cc) => {
    out[cc] = {};
    // each step on its own: one failing source (e.g. Google down) doesn't stop the others
    for (const s of steps) {
      try {
        if (s === 'trends') out[cc].trends = await runCollect(cc, ['trends']);
        else if (s === 'collect') out[cc].collect = await runCollect(cc, ['ads', 'gsc', 'site_search']);
        else if (s === 'decide') out[cc].decide = await runDecide(cc);
        else if (s === 'autopilot') out[cc].autopilot = await runAutopilot(cc, { deadline });
        else if (s === 'improve') out[cc].improve = await runImprove(cc);
      } catch (e) { out[cc][`${s}Error`] = String(e?.message || e).slice(0, 300); }
    }
  }));
  return NextResponse.json({ ok: true, job, steps, at: new Date().toISOString(), results: out });
}

export const GET = handle;
export const POST = handle;
