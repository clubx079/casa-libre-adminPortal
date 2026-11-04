// GET /api/issues/days → the saved daily Open-issues lists of the active country, newest first
// [{ day, open, urgent, total, checkedAt }] + today (lib/openIssuesDays.js). Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { dbFor } from '@/lib/db';
import { listDays, localDay } from '@/lib/openIssuesDays';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try {
    return NextResponse.json({ days: await listDays(dbFor(cc), 30), today: localDay(cc) });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
