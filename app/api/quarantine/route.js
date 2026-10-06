import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { getUsdRate } from '@/lib/fx';
import { currencyFor } from '@/lib/currency';
import { looseFor, splitReasons, canGoLive, FIXABLE_CODES, quarantineState } from '@/lib/unverified';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'released', 'discarded'];
// Reason codes the ingest pipeline emits (lib/ingest.validateListing + dedupe).
const REASON_CODES = [
  'no_price', 'no_contact', 'price_below_floor', 'price_above_ceiling', 'sale_price_as_rent',
  'duplicate', 'area_out_of_range', 'beds_over_cap', 'baths_over_cap', 'no_location', 'parking_over_cap',
  'unverified_seller',
];
// Pending records by state (lib/unverified.quarantineState): ready = can be published,
// live = the listing is already on the site (old record, clear it), blocked = held back
// (a blocking reason, or the same property as a live listing).
const VIEWS = ['all', 'ready', 'live', 'blocked'];
const DEFAULT_PAGE_SIZE = 50;
const CHUNK = 150;

// Fetch every row of a query (PostgREST pages with limit/offset).
async function selectAll(select, table, query) {
  const out = [];
  for (let off = 0; ; off += 1000) {
    const rows = await select(table, `${query}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) return out;
  }
}
const inList = (vals) => vals.map((v) => `"${String(v).replace(/"/g, '')}"`).join(',');
async function selectIn(select, table, cols, col, vals, extra = '') {
  const out = [];
  for (let i = 0; i < vals.length; i += CHUNK) {
    const part = vals.slice(i, i + CHUNK);
    if (part.length) out.push(...(await select(table, `select=${cols}&${col}=in.(${encodeURIComponent(inList(part))})${extra}`)));
  }
  return out;
}

// GET /api/quarantine?status=pending&view=ready&reason=no_price&page=1&pageSize=50
// Each row says in plain terms where it stands: can it be published, is the listing
// already on the site (active / inactive), or what holds it back — including being the
// same property as a live listing (records held for a bad field never had the scraper's
// duplicate check, so it runs here).
export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const loose = looseFor(cc);
  const { select, selectWithCount } = dbFor(cc);
  const { searchParams } = new URL(req.url);
  const status = STATUSES.includes(searchParams.get('status')) ? searchParams.get('status') : 'pending';
  const reason = REASON_CODES.includes(searchParams.get('reason')) ? searchParams.get('reason') : null;
  const view = status === 'pending' && VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'all';
  const page = Math.max(1, parseInt(searchParams.get('page'), 10) || 1);
  const pageSize = Math.min(200, Math.max(10, parseInt(searchParams.get('pageSize'), 10) || DEFAULT_PAGE_SIZE));
  const offset = (page - 1) * pageSize;
  const count = (q) => selectWithCount('ingest_quarantine', `select=id&${q}&limit=1`).then((r) => r.count).catch(() => null);

  try {
    const countsP = Promise.all(STATUSES.map((st) => count(`status=eq.${st}`).then((n) => [st, n])));
    // This country's currency per USD (prices shown in Gs. / Bs / $U; US$ only in VE).
    const rate = await getUsdRate(cc).catch(() => currencyFor(cc).fallbackRate);

    if (status !== 'pending') {
      // Released / discarded: plain list (no states), exact counts from the DB.
      const filter = `status=eq.${status}` + (reason ? `&reasons=cs.{${reason}}` : '');
      const [{ rows, count: total }, countsArr, reasonArr] = await Promise.all([
        selectWithCount('ingest_quarantine', `select=*&${filter}&order=created_at.desc&limit=${pageSize}&offset=${offset}`),
        countsP,
        Promise.all(REASON_CODES.map((code) => count(`status=eq.${status}&reasons=cs.{${code}}`).then((n) => [code, n || 0]))),
      ]);
      return NextResponse.json({
        rows, total, page, pageSize, counts: Object.fromEntries(countsArr),
        reasonCounts: Object.fromEntries(reasonArr.filter(([, n]) => n > 0)), viewCounts: {}, rate, country: cc, loose, view,
      });
    }

    // Pending: classify every record, then filter / count / page in code.
    const all = await selectAll(select, 'ingest_quarantine', 'select=id,source_id,external_id,dedupe_key,reasons,created_at&status=eq.pending&order=created_at.desc');
    const ext = [...new Set(all.map((r) => r.external_id).filter(Boolean))];
    const props = await selectIn(select, 'properties', 'id,source_id,external_id,admin_status,is_delisted', 'external_id', ext);
    const listed = new Map(props.map((p) => [`${p.source_id}|${p.external_id}`, p]));
    // live listings that are the same property (dedupe_key) as a record that could go live
    const keys = [...new Set(all.filter((r) => !listed.has(`${r.source_id}|${r.external_id}`) && canGoLive(r.reasons, cc) && r.dedupe_key).map((r) => r.dedupe_key))];
    const twins = await selectIn(select, 'properties', 'id,dedupe_key,address,city,external_id,source_id,scrape_sources(name)', 'dedupe_key', keys, '&admin_status=eq.active&is_delisted=eq.false');
    const twinByKey = new Map(twins.map((t) => [t.dedupe_key, t]));

    const info = new Map();
    for (const r of all) {
      const p = listed.get(`${r.source_id}|${r.external_id}`);
      const twin = !p && r.dedupe_key ? twinByKey.get(r.dedupe_key) : null;
      const st = quarantineState({ reasons: r.reasons, onSite: !!p, duplicateOfLive: !!twin, cc });
      info.set(r.id, {
        state: st,
        on_site: p ? (p.admin_status === 'active' && !p.is_delisted ? 'active' : 'inactive') : null,
        property_id: p?.id || null,
        duplicate_of: twin ? { id: twin.id, source: twin.scrape_sources?.name || null, address: twin.address || twin.city || null } : null,
      });
    }

    const viewCounts = { ready: 0, live: 0, blocked: 0 };
    for (const v of info.values()) viewCounts[v.state]++;
    const inView = all.filter((r) => view === 'all' || info.get(r.id).state === view);
    const reasonCounts = {};
    for (const r of inView) for (const c of r.reasons || []) reasonCounts[c] = (reasonCounts[c] || 0) + 1;
    const matched = reason ? inView.filter((r) => (r.reasons || []).includes(reason)) : inView;
    const pageIds = matched.slice(offset, offset + pageSize).map((r) => r.id);
    const full = pageIds.length ? await selectIn(select, 'ingest_quarantine', '*', 'id', pageIds) : [];
    const byId = new Map(full.map((r) => [r.id, r]));
    const rows = pageIds.map((id) => byId.get(id)).filter(Boolean).map((r) => {
      const { blocking, unverified } = splitReasons(r.reasons);
      const i = info.get(r.id);
      return { ...r, ...i, can_go_live: i.state === 'ready', blocking, unverified: loose ? unverified : [] };
    });

    const countsArr = await countsP;
    return NextResponse.json({ rows, total: matched.length, page, pageSize, counts: Object.fromEntries(countsArr), viewCounts, reasonCounts, rate, country: cc, loose, view });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
