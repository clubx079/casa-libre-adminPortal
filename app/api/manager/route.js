// GET  /api/manager → the active country's Admin Manager reports, newest first (list view).
// POST /api/manager → start a new run now ("Run now"); it works in the background, the
// page polls GET /api/manager/:id. lib/manager/run.js.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError } from '@/lib/automationDb';
import { TABLE, markStale, startRun } from '@/lib/manager/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  const db = dbFor(country);
  try {
    await markStale(db);
    const rows = await db.select(TABLE, `select=id,trigger,status,stage,period_start,period_end,created_at,finished_at,cost_usd,error,created_by,report,actions&country=eq.${country}&order=created_at.desc&limit=60`);
    return NextResponse.json({
      country,
      configured: !!process.env.ANTHROPIC_API_KEY,
      periodFrom: 'previous report',   // each report continues from the previous one (lib/manager/run.js)
      // AiroBase's PostgREST can't select a JSON path (report->>headline): read the report, keep the headline.
      reports: rows.map(({ actions, report, ...r }) => ({
        ...r,
        headline: report?.headline || null,
        drafts: (actions || []).length,
        pending: (actions || []).filter((a) => a.status === 'draft').length,
        sent: (actions || []).filter((a) => a.status === 'sent').length,
      })),
    });
  } catch (e) { return dbError(e); }
}

export async function POST() {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, { status: 400 });
  try {
    const res = await startRun(activeCountry(), { trigger: 'manual', by: session.email || null });
    if (!res.ok) return NextResponse.json({ error: res.error === 'already_running' ? 'A report is already being written for this country.' : res.error, id: res.id || null }, { status: 409 });
    return NextResponse.json({ ok: true, id: res.id });
  } catch (e) { return dbError(e); }
}
