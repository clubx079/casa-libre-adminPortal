import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import { getUsdRate } from '@/lib/fx';
import { buildingsParts, landOrGroup, isLandType } from '@/lib/land';
import { heldListings } from '@/lib/heldListings';
import { selectAll } from '@/lib/selectAll';
import { validateListing } from '@/lib/ingest';
import { looseFor, splitReasons } from '@/lib/unverified';
import PropertiesView from '@/components/PropertiesView';

export const dynamic = 'force-dynamic';

const T = {
  textPrimary: '#111111',
  textSecondary: '#6B6862',
};

const PAGE_SIZE = 24;
const COLS = 'select=id,address,city,neighborhood,price,currency,listing_type,property_type,bedrooms,bathrooms,floor_area,covered_area,land_area,parking_spaces,contact_phone,admin_status,status,feature_image_url,external_id,external_url,origin,created_by,created_at,scrape_sources(name)';

export default async function PropertiesPage({ searchParams }) {
  const { select, selectWithCount } = dbFor(activeCountry());
  const lang = getLang();
  const t = makeT(lang);

  const page = Math.max(1, parseInt(searchParams?.page || '1', 10) || 1);
  const q = (searchParams?.q || '').trim();
  const status = searchParams?.status || 'all'; // all | active | inactive | unverified
  const view = searchParams?.view === 'cards' ? 'cards' : 'table'; // default table
  const source = (searchParams?.source || '').trim(); // scrape_sources.key filter
  const cls = ['buildings', 'land', 'all'].includes(searchParams?.class) ? searchParams.class : 'buildings';
  // Properties split into two sub-tabs: 'scraped' (competitor scrapers, default) and
  // 'originals' (buyer-portal user submissions).
  const kind = searchParams?.kind === 'originals' ? 'originals' : 'scraped';
  const offset = (page - 1) * PAGE_SIZE;

  const cc = activeCountry();
  // source templates for the filter dropdown — exclude the "User submissions" virtual
  // row: user-published listings now live under the Originals sub-tab. Read at the same
  // time as this country's currency per 1 USD (live, cached).
  const [allSources, rate] = await Promise.all([
    select('scrape_sources', 'select=id,key,name&order=name.asc').catch(() => []),
    getUsdRate(cc),
  ]);
  const sources = allSources.filter((s) => s.key !== 'user_submissions');
  const sourceId = source ? sources.find((s) => s.key === source)?.id : null;

  // The filters every query below shares (sub-tab, source, buildings/land, search).
  // Originals = user self-published (no scraper source_id). Scraped = anything with a
  // scraper source, optionally narrowed to one source.
  const filters = [];
  if (kind === 'originals') {
    filters.push('origin=eq.user');
  } else {
    filters.push('source_id=not.is.null');
    if (sourceId) filters.push(`source_id=eq.${sourceId}`);
  }
  // class + text search. 'buildings' (default) hides land; 'land' shows only land;
  // 'all' shows both. land + search needs a nested and() to avoid two top-level or=.
  const qEnc = q ? encodeURIComponent(`%${q}%`) : null;
  if (cls === 'buildings') filters.push(...buildingsParts());
  if (cls === 'land') {
    if (qEnc) filters.push(`and=(or(${landOrGroup()}),or(address.ilike.${qEnc},city.ilike.${qEnc}))`);
    else filters.push(`or=(${landOrGroup()})`);
  } else if (qEnc) {
    filters.push(`or=(address.ilike.${qEnc},city.ilike.${qEnc})`);
  }
  const query = (...extra) => [COLS, ...filters, ...extra].join('&');
  const countOf = async (...extra) => (await selectWithCount('properties', ['select=id', ...filters, ...extra, 'limit=1'].join('&'))).count;

  // A property is LIVE on the buyer portal only when it is admin-active AND passes
  // the completeness gate. Compute it per row so the Active/Inactive filter and the
  // status badge both reflect exactly what buyers see. Looser rule (lib/unverified.js):
  // only missing contact or location hide a listing; fields that fail the other
  // checks are listed in _unverified and the buyer site shows "Contact seller for …".
  const loose = looseFor(cc);
  const annotate = (r) => {
    const v = validateListing(r, rate, cc);
    const { blocking, unverified } = splitReasons(v.reasons);
    const complete = v.ok || (loose && blocking.length === 0);
    return {
      ...r, _incomplete: !complete, _live: r.admin_status === 'active' && complete,
      _problems: complete ? [] : (loose ? blocking : v.reasons),   // why it's hidden from the site
      _unverified: loose ? unverified : [],                          // shown as "Contact seller for …"
    };
  };

  // Counted at the database. (It used to load the newest 5,000 rows and count those, so
  // "All" read 5000 and "Active" was only the live ones among the newest 5,000.)
  //  • Active   = live: every admin-active row is loaded (a few thousand) and checked
  //  • All      = every matching property (exact count) + listings held in Quarantine
  //  • Inactive = admin-inactive (exact count) + admin-active but incomplete + held
  //  • Data not verified = live rows the site shows with "Contact seller for …"
  let rows = [];
  let count = 0;
  let tabCounts = null;
  let error = null;
  try {
    // All at the same time: the admin-active rows (pages read in parallel), the two exact
    // counts and the held listings (cached, lib/heldListings.js).
    const [activeRaw, total, inactiveDb, heldAll] = await Promise.all([
      selectAll({ select, selectWithCount }, 'properties', query('admin_status=eq.active', 'order=created_at.desc')),
      countOf(),
      countOf('admin_status=neq.active'),
      heldListings(select, cc).catch(() => []),
    ]);
    const active = activeRaw.map(annotate);
    const live = active.filter((r) => r._live);
    const activeIncomplete = active.filter((r) => !r._live);
    const unverifiedLive = live.filter((r) => r._unverified.length > 0);

    // Listings held in Quarantine are inactive too: scraped, not on the site, they just
    // never became properties (lib/heldListings.js). Scraped tab = scraper sources;
    // Originals = the sell wizard's held addresses (user_submissions). Same filters.
    const userSrc = allSources.find((s) => s.key === 'user_submissions')?.id;
    const nameOf = new Map(allSources.map((s) => [s.id, s.name]));
    const needle = q.toLowerCase();
    const held = heldAll
      .filter((r) => (kind === 'originals' ? r.source_id === userSrc : r.source_id !== userSrc))
      .filter((r) => !sourceId || r.source_id === sourceId)
      .filter((r) => cls === 'all' || (cls === 'land') === isLandType(r.property_type))
      .filter((r) => !needle || `${r.address || ''} ${r.city || ''}`.toLowerCase().includes(needle))
      .map((r) => ({ ...r, scrape_sources: { name: nameOf.get(r.source_id) || null } }));

    tabCounts = {
      all: total + held.length,
      active: live.length,
      inactive: inactiveDb + activeIncomplete.length + held.length,
      unverified: unverifiedLive.length,
    };
    count = tabCounts[status] ?? tabCounts.all;

    // One page of: the rows already in memory first (newest first), then the database
    // rows, continuing at the right offset.
    const newestFirst = (a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''));
    const pageOf = async (mem, ...dbFilter) => {
      const fromMem = mem.slice(offset, offset + PAGE_SIZE);
      const need = PAGE_SIZE - fromMem.length;
      if (need <= 0) return fromMem;
      const dbRows = await select('properties', query(...dbFilter, 'order=created_at.desc', `limit=${need}`, `offset=${Math.max(0, offset - mem.length)}`));
      return [...fromMem, ...dbRows.map(annotate)];
    };
    rows = status === 'active' ? live.slice(offset, offset + PAGE_SIZE)
      : status === 'unverified' ? unverifiedLive.slice(offset, offset + PAGE_SIZE)
      : status === 'inactive' ? await pageOf([...activeIncomplete, ...held].sort(newestFirst), 'admin_status=neq.active')
      : await pageOf([...held].sort(newestFirst));
  } catch (e) {
    error = e.message;
  }

  // For USER-listed properties (self-published, no scraper source) the "source"
  // column should show WHO listed it — the user's email — not a blank. There is no
  // FK properties.created_by → users, so resolve it with a manual lookup.
  const listerIds = [...new Set(
    rows.filter((r) => r.created_by && !r.scrape_sources?.name).map((r) => r.created_by),
  )];
  let listerMap = {};
  if (listerIds.length) {
    try {
      const inList = listerIds.map((id) => `"${id}"`).join(',');
      const us = await select('users', `select=id,email,full_name&id=in.(${inList})`);
      listerMap = Object.fromEntries(us.map((u) => [u.id, u.email || u.full_name || null]));
    } catch { listerMap = {}; }
  }
  rows = rows.map((r) => ({
    ...r,
    _listerEmail: (r.origin === 'user' || (r.created_by && !r.scrape_sources?.name)) ? (listerMap[r.created_by] || null) : null,
  }));
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>
          {kind === 'originals' ? (lang === 'es' ? 'Publicaciones de usuarios' : 'User submissions') : `${t('prop.title1')} ${t('prop.title2')}`}
        </h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>
          {kind === 'originals' ? (lang === 'es' ? 'Propiedades publicadas por usuarios del portal' : 'Listings created by buyer-portal users') : t('prop.subtitle')}
        </p>
      </div>

      {error ? (
        <div className="text-xs px-4 py-3 rounded-[14px] font-mono" style={{ background: '#FBEDE9', color: '#8A2B16' }}>{error}</div>
      ) : (
        <PropertiesView
          rows={rows}
          count={count}
          tabCounts={tabCounts}
          page={page}
          totalPages={totalPages}
          q={q}
          status={status}
          loose={loose}
          view={view}
          lang={lang}
          rate={rate}
          country={cc}
          sources={kind === 'originals' ? [] : sources}
          source={kind === 'originals' ? '' : source}
          cls={cls}
          kind={kind}
        />
      )}
    </div>
  );
}
