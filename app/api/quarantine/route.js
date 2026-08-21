import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { selectWithCount } from '@/lib/db';
import { getUsdToPyg } from '@/lib/fx';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'released', 'discarded'];
// Reason codes the ingest pipeline emits (lib/ingest.validateListing + dedupe).
const REASON_CODES = [
  'no_price', 'no_contact', 'price_below_floor', 'sale_price_as_rent', 'duplicate',
  'area_out_of_range', 'beds_over_cap', 'baths_over_cap', 'no_location', 'parking_over_cap',
];
const DEFAULT_PAGE_SIZE = 50;

// GET /api/quarantine?status=pending&reason=no_price&page=1&pageSize=50
// Server-side paginated + reason-filtered, with exact totals so the client can
// page through the whole queue (not just the first N).
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const status = STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : 'pending';
  const reason = REASON_CODES.includes(searchParams.get('reason')) ? searchParams.get('reason') : null;
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize'), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const filter = `status=eq.${status}` + (reason ? `&reasons=cs.{${reason}}` : '');

  try {
    // The requested page of rows + the EXACT total for this status(+reason).
    const rowsP = selectWithCount(
      'ingest_quarantine',
      `select=*&${filter}&order=created_at.desc&limit=${pageSize}&offset=${offset}`,
    );
    // Exact per-status tab counts (no 1000-row cap).
    const countsP = Promise.all(
      STATUSES.map((st) =>
        selectWithCount('ingest_quarantine', `select=id&status=eq.${st}&limit=1`)
          .then((r) => [st, r.count])
          .catch(() => [st, null]),
      ),
    );
    // Exact per-reason counts for the current status → drives the filter chips.
    const reasonP = Promise.all(
      REASON_CODES.map((code) =>
        selectWithCount('ingest_quarantine', `select=id&status=eq.${status}&reasons=cs.{${code}}&limit=1`)
          .then((r) => [code, r.count])
          .catch(() => [code, 0]),
      ),
    );
    const [{ rows, count: total }, countsArr, reasonArr] = await Promise.all([rowsP, countsP, reasonP]);
    const counts = Object.fromEntries(countsArr);
    const reasonCounts = Object.fromEntries(reasonArr.filter(([, n]) => n > 0));
    const rate = await getUsdToPyg().catch(() => Number(process.env.PYG_PER_USD) || 7300);
    return NextResponse.json({ rows, total, page, pageSize, counts, reasonCounts, rate });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
