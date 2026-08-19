import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select } from '@/lib/db';
import { startRun, runJob, getActiveRun } from '@/lib/scrape';

export const runtime = 'nodejs';
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

// POST /api/scrape  { sourceKey, filters }
// Creates a run row, launches the job in the BACKGROUND (not awaited, so it
// survives the client disconnecting/refreshing), and returns the runId to poll.
export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  let sourceKey, filters;
  try {
    ({ sourceKey, filters } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  if (!sourceKey) return NextResponse.json({ error: 'sourceKey requerido' }, { status: 400 });

  try {
    const { runId, attached } = await startRun({ sourceKey, filters: filters || {}, trigger: 'manual' });
    // fire-and-forget: keeps running on the server after the response is sent.
    if (!attached) runJob({ runId }).catch(() => {});
    return NextResponse.json({ runId, attached });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// GET /api/scrape?runId=...      -> that run's live state
// GET /api/scrape?sourceKey=...  -> the active (running|paused) run for a source, if any
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('runId');
  const sourceKey = searchParams.get('sourceKey');

  try {
    if (runId) {
      const rows = await select(
        'scrape_runs',
        `id=eq.${runId}&select=id,status,control,progress,total_found,inserted_count,updated_count,skipped_count,images_uploaded,errors,started_at,finished_at&limit=1`
      );
      return NextResponse.json({ run: rows[0] || null });
    }
    if (sourceKey) {
      const src = await select('scrape_sources', `key=eq.${encodeURIComponent(sourceKey)}&select=id&limit=1`);
      if (!src.length) return NextResponse.json({ run: null });
      const run = await getActiveRun(src[0].id); // reaps stale runs, returns a live one or null
      return NextResponse.json({ run });
    }
    return NextResponse.json({ error: 'runId o sourceKey requerido' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
