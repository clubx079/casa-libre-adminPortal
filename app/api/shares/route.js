// GET /api/shares?days=7|30|90[&force=1] → the "Listing shares" numbers of the active country
// (lib/shareData.js: PostHog share events + visits from share links, the share_reward log).
// Read-only. The Shares page renders the same data on the server; this is for a refresh / tools.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { sharesFor } from '@/lib/shareData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const u = new URL(req.url);
  try {
    return NextResponse.json(await sharesFor(activeCountry(), Number(u.searchParams.get('days')) || 30, { force: u.searchParams.get('force') === '1' }));
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
