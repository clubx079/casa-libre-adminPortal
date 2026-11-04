// GET  /api/issues?day=yyyy-mm-dd&fresh=1 → that day's Open issues for the active country
//      (lib/openIssuesStore.js getDayIssues: today = the saved list, or a fresh run, saved; a past
//      day = its saved list with the team's decisions since) { issues, counts, day, isToday, … }
// POST /api/issues { id, action, text?, lang?, note? } → lib/openIssuesActions.js (always on the
//      current list: an issue that is no longer open can't be acted on)
// Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { getDayIssues } from '@/lib/openIssuesStore';
import { runIssueAction } from '@/lib/openIssuesActions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  try {
    const data = await getDayIssues(activeCountry(), { day: sp.get('day'), fresh: sp.get('fresh') === '1' });
    if (!data) return NextResponse.json({ error: 'No open-issues list for that day.' }, { status: 404 });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  if (!b.id || !b.action) return NextResponse.json({ error: 'id and action are required' }, { status: 400 });
  try {
    const r = await runIssueAction(activeCountry(), b, session);
    return NextResponse.json(r, { status: r.ok ? 200 : 400 });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
