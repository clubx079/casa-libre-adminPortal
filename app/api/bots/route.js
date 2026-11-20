// Bots page data: GET /api/bots → per bot: connected?, last test, latest runs (lib/bots/store.js). No secrets.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { overview, isMissingTable } from '@/lib/bots/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json({ bots: await overview() }); }
  catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ pending: true, bots: null });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
