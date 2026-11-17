// The SEO pipeline on a timer (AiroBase Cron, `Authorization: Bearer {{secrets.CRON_SECRET}}`):
//   ?job=trends              hourly   Google Trends RSS                        "5 * * * *"
//   ?job=daily               daily    Ads + Search Console + site search, then Decide   "0 9 * * *" (06:00 PY)
//   ?job=improve             weekly   the Improve loop                          "0 10 * * 1"
//   ?job=collect|decide      one stage
// ?country=py|bo|uy|ve|sv|all (default all). Answers with each country's result.
import { NextResponse } from 'next/server';
import { runCollect, runDecide, runImprove } from '@/lib/seo/run';
import { SEO_COUNTRIES } from '@/lib/seo/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const job = sp.get('job') || 'daily';
  const c = (sp.get('country') || 'all').toLowerCase();
  const countries = c === 'all' ? SEO_COUNTRIES : SEO_COUNTRIES.includes(c) ? [c] : null;
  if (!countries) return NextResponse.json({ error: 'bad country' }, { status: 400 });
  const out = {};
  for (const cc of countries) {
    try {
      if (job === 'trends') out[cc] = { collect: await runCollect(cc, ['trends']) };
      else if (job === 'collect') out[cc] = { collect: await runCollect(cc, ['ads', 'gsc', 'site_search']) };
      else if (job === 'decide') out[cc] = { decide: await runDecide(cc) };
      else if (job === 'daily') out[cc] = { collect: await runCollect(cc, ['ads', 'gsc', 'site_search']), decide: await runDecide(cc) };
      else if (job === 'improve') out[cc] = { improve: await runImprove(cc) };
      else return NextResponse.json({ error: 'unknown job' }, { status: 400 });
    } catch (e) { out[cc] = { error: String(e?.message || e).slice(0, 300) }; }
  }
  return NextResponse.json({ ok: true, job, at: new Date().toISOString(), results: out });
}

export const GET = handle;
export const POST = handle;
