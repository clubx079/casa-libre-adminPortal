import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { getUsdRate } from '@/lib/fx';
import { currencyFor } from '@/lib/currency';
import { looseFor, splitReasons, canGoLive, FIXABLE_CODES, quarantineState, reasonsNow } from '@/lib/unverified';
import { validateListing } from '@/lib/ingest';
import { buildingsParts } from '@/lib/land';
import { listingUrl } from '@/lib/buyerSite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUSES = ['pending', 'released', 'discarded'];
// Reason codes the ingest pipeline emits (lib/ingest.validateListing + dedupe).
const REASON_CODES = [
  'no_price', 'no_contact', 'price_below_floor', 'price_above_ceiling', 'sale_price_as_rent',
  'duplicate', 'area_out_of_range', 'beds_over_cap', 'baths_over_cap', 'no_location', 'parking_over_cap',
  'unverified_seller',
];
// The three things that hold a listing back — the only reasons the Reason filter offers
// for pending records. A record's other problems still show on its row.
const BLOCK_FILTER = ['no_contact', 'duplicate', 'unverified_seller'];
// Pending views: 'blocked' — every record still held back (normally all are blocked; one
// that is already live or could go live says so on its row), or 'incomplete' — not
// quarantine records but LIVE listings with a field the site shows as "Contact seller
// for …" (bad price, area, bedrooms, bathrooms or parking), so it's clear those don't
// hold a listing back.
const VIEWS = ['blocked', 'incomplete'];
const DEFAULT_PAGE_SIZE = 50;
const CHUNK = 150;
const INCOMPLETE_CACHE_MS = 60 * 1000;
const incompleteCache = (globalThis.__clIncompleteCache ||= new Map());

// Live listings (active, not delisted, buildings) whose only problems are fields the site
// shows as "Contact seller for …". Same check as the Properties page. Cached 60s per
// country: the page refetches on every filter change.
async function activeIncomplete(select, cc, rate) {
  const hit = incompleteCache.get(cc);
  if (hit && Date.now() - hit.at < INCOMPLETE_CACHE_MS) return hit.rows;
  const cols = 'id,address,city,neighborhood,zone_canonical,price,currency,listing_type,property_type,bedrooms,bathrooms,floor_area,covered_area,land_area,parking_spaces,contact_phone,external_id,external_url,created_at';
  const props = await selectAll(select, 'properties', `select=${cols}&admin_status=eq.active&is_delisted=eq.false&${buildingsParts().join('&')}&order=created_at.desc`);
  const rows = [];
  for (const p of props) {
    const { reasons } = validateListing(p, rate, cc);
    const { blocking, unverified } = splitReasons(reasons);
    if (blocking.length || !unverified.length) continue;   // hidden from the site, or complete
    rows.push({
      id: p.id, property_id: p.id, external_id: p.external_id, created_at: p.created_at,
      payload: p, reasons: reasons.filter((r) => FIXABLE_CODES.includes(r)), unverified,
      state: 'incomplete', on_site: 'active', public_url: listingUrl(cc, p.id),
    });
  }
  incompleteCache.set(cc, { at: Date.now(), rows });
  return rows;
}

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

// GET /api/quarantine?status=pending&view=blocked&reason=no_contact&page=1&pageSize=50
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
  const view = status === 'pending' && VIEWS.includes(searchParams.get('view')) ? searchParams.get('view') : 'blocked';
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
    // live listings that are the same property (dedupe_key) as a record that could go live,
    // or that a "duplicate" record was held for (a duplicate only blocks while that's live)
    const isDup = (r) => (r.reasons || []).includes('duplicate');
    const keys = [...new Set(all.filter((r) => !listed.has(`${r.source_id}|${r.external_id}`) && (isDup(r) || canGoLive(r.reasons, cc)) && r.dedupe_key).map((r) => r.dedupe_key))];
    const twins = await selectIn(select, 'properties', 'id,dedupe_key,address,city,external_id,source_id,scrape_sources(name)', 'dedupe_key', keys, '&admin_status=eq.active&is_delisted=eq.false');
    const twinByKey = new Map(twins.map((t) => [t.dedupe_key, t]));

    const info = new Map();
    for (const r of all) {
      const p = listed.get(`${r.source_id}|${r.external_id}`);
      const twin = !p && r.dedupe_key ? twinByKey.get(r.dedupe_key) : null;
      const twinGone = !p && !twin && !!r.dedupe_key && isDup(r);
      const st = quarantineState({ reasons: r.reasons, onSite: !!p, duplicateOfLive: !!twin, twinGone, cc });
      info.set(r.id, {
        state: st,
        twin_gone: twinGone,
        reasons_now: twinGone ? reasonsNow(r.reasons, false) : r.reasons || [],
        on_site: p ? (p.admin_status === 'active' && !p.is_delisted ? 'active' : 'inactive') : null,
        property_id: p?.id || null,
        duplicate_of: twin ? { id: twin.id, source: twin.scrape_sources?.name || null, address: twin.address || twin.city || null } : null,
      });
    }

    // Live listings shown with "Contact seller for …" (null if they couldn't be read)
    const incomplete = loose ? await activeIncomplete(select, cc, rate).catch(() => null) : [];
    const viewCounts = { blocked: all.length, incomplete: incomplete ? incomplete.length : null };

    if (view === 'incomplete') {
      if (!incomplete) throw new Error('Could not read the live listings');
      const reasonCounts = {};
      for (const r of incomplete) for (const c of r.reasons) reasonCounts[c] = (reasonCounts[c] || 0) + 1;
      const matched = reason ? incomplete.filter((r) => r.reasons.includes(reason)) : incomplete;
      const countsArr = await countsP;
      return NextResponse.json({ rows: matched.slice(offset, offset + pageSize), total: matched.length, page, pageSize, counts: Object.fromEntries(countsArr), viewCounts, reasonCounts, rate, country: cc, loose, view });
    }

    const inView = all;
    const reasonCounts = {};
    for (const r of inView) for (const c of info.get(r.id).reasons_now) if (BLOCK_FILTER.includes(c)) reasonCounts[c] = (reasonCounts[c] || 0) + 1;
    const matched = reason ? inView.filter((r) => info.get(r.id).reasons_now.includes(reason)) : inView;
    const pageIds = matched.slice(offset, offset + pageSize).map((r) => r.id);
    const full = pageIds.length ? await selectIn(select, 'ingest_quarantine', '*', 'id', pageIds) : [];
    const byId = new Map(full.map((r) => [r.id, r]));
    const rows = pageIds.map((id) => byId.get(id)).filter(Boolean).map((r) => {
      const i = info.get(r.id);
      const { blocking, unverified } = splitReasons(i.reasons_now);
      return { ...r, ...i, can_go_live: i.state === 'ready', blocking, unverified: loose ? unverified : [] };
    });

    const countsArr = await countsP;
    return NextResponse.json({ rows, total: matched.length, page, pageSize, counts: Object.fromEntries(countsArr), viewCounts, reasonCounts, rate, country: cc, loose, view });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
