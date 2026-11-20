// The AI SEO pipeline of the six Casa-Libre SEO sites + the casa-libre.com hub on a timer (AiroBase Cron,
// `Authorization: Bearer {{secrets.CRON_SECRET}}`). ONE cron for all seven:   ?job=all   once a day
//   → per site: Google Trends, Search Console (+ Ads for the PY sites), Decide, Autopilot (writes and
//   publishes guides, adds links, within the daily caps), Improve, then the run record + AI report and ONE
//   publish ping to the site (lib/seoSites/runLog.js). Sites run side by side, each with the same deadline
//   logic as /api/cron/seo (Autopilot stops at 120 s, the next run continues).
// ?site=<key> (org|online|agpy|agbo|libpy|libbo|hub, default all) · single stages (manual, not recorded):
// ?job=trends | collect | decide | autopilot | improve
import { NextResponse } from 'next/server';
import { runSitePipeline, STEPS } from '@/lib/seoSites/runLog';
import { SITE_KEYS, siteKeyParam } from '@/lib/seoSites/scope';

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
  const s = (sp.get('site') || 'all').toLowerCase();
  const keys = s === 'all' ? SITE_KEYS : siteKeyParam(s) ? [siteKeyParam(s)] : null;
  if (!keys) return NextResponse.json({ error: 'bad site' }, { status: 400 });
  const deadline = Date.now() + 120000;
  const out = {};
  await Promise.all(keys.map(async (key) => {
    try {
      out[key] = job === 'all'
        ? await runSitePipeline(key, { trigger: 'cron', deadline })
        : await runSitePipeline(key, { trigger: `manual:${job}`, deadline, steps: [job], record: false });
    } catch (e) { out[key] = { error: String(e?.message || e).slice(0, 300) }; }
  }));
  return NextResponse.json({ ok: true, job, at: new Date().toISOString(), results: out });
}

export const GET = handle;
export const POST = handle;
