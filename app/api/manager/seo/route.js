// Admin Manager → AI SEO tab (components/manager/SeoTab.js).
// GET  /api/manager/seo           → the active country's SEO runs, newest first (light rows)
// GET  /api/manager/seo?id=<uuid> → one run in full (report, changes, snapshot, comparison)
// POST /api/manager/seo           → "Run now": the full pipeline + report for the active country, in the
//                                   background (the tab polls); refused while one is already running.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { mayRead } from '@/lib/analyst/access';
import { ccOf, isMissingTable } from '@/lib/seo/store';
import { listRuns, getRun, runningRun, runPipeline } from '@/lib/seo/runLog';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{36}$/i;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
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

export async function POST() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const cc = ccOf(activeCountry());
  if (!mayRead(cc)) return NextResponse.json({ error: 'You do not have access to this country.' }, { status: 403 });
  try {
    if (await runningRun(cc)) return NextResponse.json({ error: 'A run is already in progress for this country.' }, { status: 409 });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: 'Run migrations/012_seo_runs.sql in this country\'s database first.' }, { status: 400 });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
  // background: the admin server is long-lived (Docker); the tab polls GET until the run is done
  runPipeline(cc, { trigger: 'manual', by: session.email || null, deadline: Date.now() + 150000 }).catch(() => {});
  return NextResponse.json({ ok: true, started: true });
}
