// Admin Manager → AI SEO tab (components/manager/SeoTab.js).
// GET  /api/manager/seo           → the active country's SEO runs, newest first (light rows)
// GET  /api/manager/seo?id=<uuid> → one run in full (report, changes, snapshot, comparison)
// POST /api/manager/seo           → "Run now": the full pipeline + report for the active country, in the
//                                   background (the tab polls); refused while one is already running.
// ?site=<key> (org|online|agpy|agbo|libpy|libbo): the same for one of the six SEO sites (Funnels → AI SEO,
// lib/seoSites/runLog.js; rows in the PY DB with country 'site:<key>'). Without it: exactly as before.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { mayRead } from '@/lib/analyst/access';
import { ccOf, isMissingTable } from '@/lib/seo/store';
import { listRuns, getRun, runningRun, runPipeline, isRunning } from '@/lib/seo/runLog';
import * as SiteRuns from '@/lib/seoSites/runLog';
import { siteFor } from '@/lib/seoSites/scope';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

// ?site= → the site (null = the buyer pipeline). An unknown key is an error, never a silent fallback.
function siteParam(req) {
  const v = new URL(req.url).searchParams.get('site');
  if (v == null || v === '') return { site: null };
  const site = siteFor(v);
  return site ? { site } : { error: NextResponse.json({ error: 'unknown site' }, { status: 400 }) };
}
const mayReadSite = (site) => site.countries.some((cc) => mayRead(cc));

async function siteGET(req, site) {
  if (!mayReadSite(site)) return NextResponse.json({ error: 'You do not have access to this site.' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id');
  try {
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
      const run = await SiteRuns.getRun(site.key, id);
      return run ? NextResponse.json({ site: site.key, run }) : NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ site: site.key, runs: await SiteRuns.listRuns(site.key) });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ site: site.key, pending: true, runs: [] });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}

async function sitePOST(site, session) {
  if (!mayReadSite(site)) return NextResponse.json({ error: 'You do not have access to this site.' }, { status: 403 });
  try {
    if (SiteRuns.isRunning(site.key) || await SiteRuns.runningRun(site.key)) return NextResponse.json({ error: 'A run is already in progress for this site.' }, { status: 409 });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: 'Run migrations/012_seo_runs.sql in the PY database first.' }, { status: 400 });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
  SiteRuns.runSitePipeline(site.key, { trigger: 'manual', by: session.email || null, deadline: Date.now() + 120000 }).catch(() => {});
  return NextResponse.json({ ok: true, started: true, site: site.key });
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = siteParam(req);
  if (sp.error) return sp.error;
  if (sp.site) return siteGET(req, sp.site);
  const cc = ccOf(activeCountry());
  if (!mayRead(cc)) return NextResponse.json({ error: 'You do not have access to this country.' }, { status: 403 });
  const id = new URL(req.url).searchParams.get('id');
  try {
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: 'bad id' }, { status: 400 });
      const run = await getRun(cc, id);
      return run ? NextResponse.json({ country: cc, run }) : NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ country: cc, runs: await listRuns(cc) });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ country: cc, pending: true, runs: [] });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = siteParam(req);
  if (sp.error) return sp.error;
  if (sp.site) return sitePOST(sp.site, session);
  const cc = ccOf(activeCountry());
  if (!mayRead(cc)) return NextResponse.json({ error: 'You do not have access to this country.' }, { status: 403 });
  try {
    if (isRunning(cc) || await runningRun(cc)) return NextResponse.json({ error: 'A run is already in progress for this country.' }, { status: 409 });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: 'Run migrations/012_seo_runs.sql in this country\'s database first.' }, { status: 400 });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
  // background: the admin server is long-lived (Docker); the tab polls GET until the run is done
  runPipeline(cc, { trigger: 'manual', by: session.email || null, deadline: Date.now() + 120000 }).catch(() => {});
  return NextResponse.json({ ok: true, started: true });
}
