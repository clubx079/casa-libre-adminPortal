import { selectWithCount, select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import { getUsdToPyg } from '@/lib/fx';
import { buildingsParts, landOrGroup } from '@/lib/land';
import PropertiesView from '@/components/PropertiesView';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 24;

export default async function PropertiesPage({ searchParams }) {
  const lang = getLang();
  const t = makeT(lang);

  const page = Math.max(1, parseInt(searchParams?.page || '1', 10) || 1);
  const q = (searchParams?.q || '').trim();
  const status = searchParams?.status || 'all'; // all | active | inactive
  const view = searchParams?.view === 'cards' ? 'cards' : 'table'; // default table
  const source = (searchParams?.source || '').trim(); // scrape_sources.key filter
  const cls = ['buildings', 'land', 'all'].includes(searchParams?.class) ? searchParams.class : 'buildings';
  const offset = (page - 1) * PAGE_SIZE;

  // source templates for the filter dropdown (+ resolve the selected one to its id)
  let sources = [];
  try {
    sources = await select('scrape_sources', 'select=id,key,name&order=name.asc');
  } catch { sources = []; }
  const sourceId = source ? sources.find((s) => s.key === source)?.id : null;

  const parts = [
    'select=id,address,city,neighborhood,price,currency,listing_type,property_type,bedrooms,bathrooms,floor_area,admin_status,status,feature_image_url,external_id,external_url,scrape_sources(name)',
    'order=created_at.desc',
    `limit=${PAGE_SIZE}`,
    `offset=${offset}`,
  ];
  if (status === 'active') parts.push('admin_status=eq.active');
  if (status === 'inactive') parts.push('admin_status=eq.inactive');
  if (sourceId) parts.push(`source_id=eq.${sourceId}`);

  // class + text search. 'buildings' (default) hides land; 'land' shows only land;
  // 'all' shows both. land + search needs a nested and() to avoid two top-level or=.
  const qEnc = q ? encodeURIComponent(`%${q}%`) : null;
  if (cls === 'buildings') parts.push(...buildingsParts());
  if (cls === 'land') {
    if (qEnc) parts.push(`and=(or(${landOrGroup()}),or(address.ilike.${qEnc},city.ilike.${qEnc}))`);
    else parts.push(`or=(${landOrGroup()})`);
  } else if (qEnc) {
    parts.push(`or=(address.ilike.${qEnc},city.ilike.${qEnc})`);
  }

  let rows = [];
  let count = 0;
  let error = null;
  try {
    ({ rows, count } = await selectWithCount('properties', parts.join('&')));
  } catch (e) {
    error = e.message;
  }

  const rate = await getUsdToPyg(); // guaraníes per 1 USD (live, cached)
  const totalPages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  return (
    <div className="p-6 md:p-10">
      <header className="mb-6">
        <div className="font-mono text-xs uppercase tracking-label text-ink/50 mb-2">{t('prop.kicker')}</div>
        <h1 className="text-[clamp(30px,5vw,44px)] tracking-display font-bold m-0">
          {t('prop.title1')} <em className="font-serif italic font-normal">{t('prop.title2')}</em>
        </h1>
      </header>

      {error ? (
        <div className="bg-hatch1 border border-ink/20 rounded-card px-5 py-4 text-sm font-mono">{error}</div>
      ) : (
        <PropertiesView
          rows={rows}
          count={count}
          page={page}
          totalPages={totalPages}
          q={q}
          status={status}
          view={view}
          lang={lang}
          rate={rate}
          sources={sources}
          source={source}
          cls={cls}
        />
      )}
    </div>
  );
}
