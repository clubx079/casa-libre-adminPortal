import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { getUsdToPyg } from '@/lib/fx';
import { looseFor, splitReasons, canGoLive, FIXABLE_CODES, BLOCKING_CODES } from '@/lib/unverified';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'released', 'discarded'];
// Reason codes the ingest pipeline emits (lib/ingest.validateListing + dedupe).
const REASON_CODES = [
  'no_price', 'no_contact', 'price_below_floor', 'price_above_ceiling', 'sale_price_as_rent',
  'duplicate', 'area_out_of_range', 'beds_over_cap', 'baths_over_cap', 'no_location', 'parking_over_cap',
  'unverified_seller',
];
// ready   = every reason is a field the buyer site shows as "Contact seller for …"
//           (Paraguay, lib/unverified.js) → publishable.
// blocked = at least one reason that holds the listing back (no contact, no location,
//           duplicate, unverified seller…).
const VIEWS = ['all', 'ready', 'blocked'];
// (cd = contained in; this PostgREST rejects not.cd, so blocked = overlaps a blocking code.)
const viewFilter = (view) => (view === 'ready' ? `&reasons=cd.{${FIXABLE_CODES.join(',')}}`
  : view === 'blocked' ? `&reasons=ov.{${BLOCKING_CODES.join(',')}}` : '');
const DEFAULT_PAGE_SIZE = 50;

// GET /api/quarantine?status=pending&view=ready&reason=no_price&page=1&pageSize=50
// Server-side paginated + filtered, with exact totals so the client can page through
// the whole queue (not just the first N). Each row also says whether it can go live
// under the looser rule, which fields would read "Contact seller for …", and whether
// the listing is already in properties (active / inactive).
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const loose = looseFor(cc);
  const { select, selectWithCount } = dbFor(cc);
  const { searchParams } = new URL(req.url);
  const status = STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : 'pending';
  const reason = REASON_CODES.includes(searchParams.get('reason')) ? searchParams.get('reason') : null;
  const view = loose && VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'all';
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize'), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;

  const filter = `status=eq.${status}` + viewFilter(view) + (reason ? `&reasons=cs.{${reason}}` : '');
  const count = (q) => selectWithCount('ingest_quarantine', `select=id&${q}&limit=1`).then((r) => r.count).catch(() => null);

  try {
    // The requested page of rows + the EXACT total for this status(+view+reason).
    const rowsP = selectWithCount(
      'ingest_quarantine',
      `select=*&${filter}&order=created_at.desc&limit=${pageSize}&offset=${offset}`,
    );
    // Exact per-status tab counts (no 1000-row cap).
    const countsP = Promise.all(STATUSES.map((st) => count(`status=eq.${st}`).then((n) => [st, n])));
    // Exact can-go-live / blocked counts for the current status (Paraguay).
    const viewP = loose
      ? Promise.all(['ready', 'blocked'].map((v) => count(`status=eq.${status}${viewFilter(v)}`).then((n) => [v, n])))
      : Promise.resolve([]);
    // Exact per-reason counts for the current status+view → drives the filter.
    const reasonP = Promise.all(
      REASON_CODES.map((code) => count(`status=eq.${status}${viewFilter(view)}&reasons=cs.{${code}}`).then((n) => [code, n || 0])),
    );
    const [{ rows, count: total }, countsArr, viewArr, reasonArr] = await Promise.all([rowsP, countsP, viewP, reasonP]);
    const counts = Object.fromEntries(countsArr);
    const viewCounts = Object.fromEntries(viewArr);
    const reasonCounts = Object.fromEntries(reasonArr.filter(([, n]) => n > 0));
    const rate = await getUsdToPyg().catch(() => Number(process.env.PYG_PER_USD) || 7300);

    // Is each listing already in properties? (a later scrape or a release published it)
    const ext = [...new Set(rows.map((r) => r.external_id).filter(Boolean))];
    let listed = new Map();
    if (ext.length) {
      try {
        const inList = ext.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',');
        const props = await select('properties', `select=id,source_id,external_id,admin_status,is_delisted&external_id=in.(${inList})&limit=${ext.length * 3}`);
        listed = new Map(props.map((p) => [`${p.source_id}|${p.external_id}`, p]));
      } catch { listed = new Map(); }
    }
    const enriched = rows.map((r) => {
      const { blocking, unverified } = splitReasons(r.reasons);
      const p = listed.get(`${r.source_id}|${r.external_id}`);
      const onSite = p ? (p.admin_status === 'active' && !p.is_delisted ? 'active' : 'inactive') : null;
      return { ...r, can_go_live: canGoLive(r.reasons, cc), blocking, unverified: loose ? unverified : [], on_site: onSite, property_id: p?.id || null };
    });

    return NextResponse.json({ rows: enriched, total, page, pageSize, counts, viewCounts, reasonCounts, rate, loose, view });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
