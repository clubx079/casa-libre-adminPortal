// GET  /api/manager/analyst → the AI Analyst's saved runs (newest first) + the active country.
// POST /api/manager/analyst { country: 'py'|…|'all', days: 7|28|90 } or { country, start, end }
//      → starts a run in the background ({ id }); the page polls /api/manager/analyst/:id.
// Read-only on every data source; runs are kept in memory + a local file (lib/analyst/run.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry, allowedCountryCodes } from '@/lib/adminCountry';
import { ANALYST_DAYS } from '@/lib/analyst/math';
import { mayRead } from '@/lib/analyst/access';
import { listRuns, startAnalysis } from '@/lib/analyst/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const runs = (await listRuns()).filter((r) => mayRead(r.country));
  return NextResponse.json({ country: activeCountry(), allCountries: !allowedCountryCodes(), configured: !!process.env.ANTHROPIC_API_KEY, runs });
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set on the server.' }, { status: 400 });
  const body = await req.json().catch(() => ({}));
  const country = String(body.country || activeCountry()).toLowerCase();
  if (!mayRead(country)) return NextResponse.json({ error: 'You do not have access to that country.' }, { status: 403 });
  const custom = body.start || body.end;
  if (custom && !(/^\d{4}-\d{2}-\d{2}$/.test(String(body.start)) && /^\d{4}-\d{2}-\d{2}$/.test(String(body.end)))) {
    return NextResponse.json({ error: 'start and end must be dates (YYYY-MM-DD).' }, { status: 400 });
  }
  const days = ANALYST_DAYS.includes(Number(body.days)) ? Number(body.days) : 28;
  const res = await startAnalysis({ country, days, start: custom ? body.start : null, end: custom ? body.end : null, by: session.email || null });
  return NextResponse.json({ ok: true, ...res });
}
