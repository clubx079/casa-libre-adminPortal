import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select } from '@/lib/db';
import { getUsdToPyg } from '@/lib/fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'released', 'discarded'];

// GET /api/quarantine?status=pending -> quarantined ingest records, newest first.
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  let q = 'select=*&order=created_at.desc&limit=500';
  if (status && STATUSES.includes(status)) q += `&status=eq.${status}`;
  try {
    const rows = await select('ingest_quarantine', q);
    // Lightweight per-status counts for the filter tabs.
    const counts = {};
    for (const st of STATUSES) {
      try {
        const c = await select('ingest_quarantine', `select=id&status=eq.${st}&limit=1000`);
        counts[st] = c.length;
      } catch { counts[st] = null; }
    }
    // live ₲/USD rate (open.er-api.com) so the client can show USD-main pricing
    const rate = await getUsdToPyg().catch(() => Number(process.env.PYG_PER_USD) || 7300);
    return NextResponse.json({ rows, counts, rate });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
