import { notFound, redirect } from 'next/navigation';
import { select } from '@/lib/db';
import { getSession } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import { makeT, locale } from '@/lib/i18n';
import { getUsdToPyg } from '@/lib/fx';
import { dualPrice, fmtUsd, fmtPyg } from '@/lib/money';
import { typeLabel } from '@/lib/propertyType';

export const dynamic = 'force-dynamic';

// Standalone marketplace-style preview (no admin sidebar) — how the listing
// would look on the public Casa Libre site. Auth-gated (uses the secret key).
export default async function PreviewPage({ params }) {
  if (!getSession()) redirect('/login');
  const lang = getLang();
  const t = makeT(lang);
  const loc = locale(lang);

  let p = null;
  try {
    const rows = await select(
      'properties',
      `id=eq.${params.id}&select=*,property_images(storage_url,is_feature,position)&limit=1`
    );
    p = rows[0] || null;
  } catch {
    p = null;
  }
  if (!p) notFound();

  const imgs = (p.property_images || []).sort((a, b) => (b.is_feature - a.is_feature) || (a.position - b.position));
  const feature = imgs[0];
  const rest = imgs.slice(1, 5);
  const rate = await getUsdToPyg(); // guaraníes per 1 USD (live, cached)
  const m = dualPrice(p.price, p.currency, rate);
  const rentSfx = p.listing_type === 'rent' ? t('preview.perMonth') : '';
  const specs = [
    p.bedrooms != null && [p.bedrooms, t('preview.bedrooms')],
    p.bathrooms != null && [p.bathrooms, t('preview.bathrooms')],
    p.floor_area != null && [`${p.floor_area} m²`, t('preview.area')],
    p.parking_spaces != null && [p.parking_spaces, t('preview.parking')],
  ].filter(Boolean);
  const features = Array.isArray(p.features) ? p.features.filter((x) => typeof x === 'string') : [];

  return (
    <div className="min-h-screen bg-paper text-ink">
      {/* preview banner */}
      <div className="bg-ink text-paper font-mono text-[11px] uppercase tracking-label py-2 text-center">
        {t('preview.badge')} · casa-libre.py
      </div>

      {/* simple marketplace nav */}
      <nav className="flex items-center justify-between px-6 md:px-11 py-4 border-b border-ink/10 max-w-[1200px] mx-auto">
        <span className="font-bold text-[22px] tracking-head">casa-libre<em className="font-serif italic font-normal">.py</em></span>
        <span className="text-[11px] font-semibold px-3 py-1 rounded-pill bg-ink text-paper">
          {p.listing_type === 'rent' ? t('preview.forRent') : t('preview.forSale')}
        </span>
      </nav>

      <main className="max-w-[1200px] mx-auto px-6 md:px-11 py-8">
        {/* gallery */}
        <div className="grid md:grid-cols-[2fr_1fr] gap-3 mb-8">
          <div className="h-[300px] md:h-[440px] cl-hatch rounded-card overflow-hidden">
            {feature ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={feature.storage_url} alt="" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full grid place-items-center font-mono text-sm text-ink/40">{t('preview.noImage')}</div>
            )}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-1 gap-3">
            {rest.map((im, i) => (
              <div key={i} className="h-[140px] md:h-[104px] cl-hatch rounded-input overflow-hidden">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={im.storage_url} alt="" className="w-full h-full object-cover" />
              </div>
            ))}
          </div>
        </div>

        <div className="grid md:grid-cols-[1fr_320px] gap-10">
          {/* main column */}
          <div>
            {typeLabel(p.property_type, lang) && (
              <span className="inline-block mb-3 text-[12px] font-semibold px-3 py-1 rounded-pill border border-ink/25 bg-card">
                {t('preview.type')}: {typeLabel(p.property_type, lang)}
              </span>
            )}
            <div className="text-[clamp(30px,5vw,46px)] font-bold tracking-display">{fmtUsd(m.usd, loc)}{rentSfx}</div>
            <div className="text-[18px] font-semibold text-ink/55 mt-0.5">{fmtPyg(m.pyg, loc)}{rentSfx}</div>
            <h1 className="text-[22px] font-semibold mt-2 mb-1 tracking-head">{p.city || ''}{p.neighborhood ? ` · ${p.neighborhood}` : ''}</h1>
            <p className="text-ink/60 text-[15px] m-0">{p.address}</p>
            {p.external_url && (
              <a href={p.external_url} target="_blank" rel="noopener noreferrer"
                 className="inline-block mt-3 text-[13px] font-semibold px-4 py-2 border-[1.5px] border-ink rounded-pill hover:bg-ink hover:text-paper transition-colors">
                {t('preview.viewSource')}
              </a>
            )}

            {/* specs */}
            {specs.length > 0 && (
              <div className="flex flex-wrap gap-8 mt-6 pt-6 border-t border-ink/10">
                {specs.map(([v, l], i) => (
                  <div key={i}>
                    <div className="text-[26px] font-bold tracking-head">{v}</div>
                    <div className="font-mono text-[11px] text-ink/50">{l}</div>
                  </div>
                ))}
              </div>
            )}

            {/* description */}
            {p.description && (
              <div className="mt-8">
                <h2 className="text-[18px] font-bold tracking-head mb-3">{t('preview.description')}</h2>
                <p className="text-[15px] leading-relaxed text-ink/75 whitespace-pre-line m-0">{p.description}</p>
              </div>
            )}

            {/* features */}
            {features.length > 0 && (
              <div className="mt-8">
                <h2 className="text-[18px] font-bold tracking-head mb-3">{t('preview.features')}</h2>
                <div className="flex flex-wrap gap-2">
                  {features.map((f, i) => (
                    <span key={i} className="text-[13px] font-medium px-3.5 py-1.5 border border-ink/25 rounded-pill bg-card">{f}</span>
                  ))}
                </div>
              </div>
            )}

            {/* location */}
            {p.latitude != null && p.longitude != null && (
              <div className="mt-8">
                <h2 className="text-[18px] font-bold tracking-head mb-3">{t('preview.location')}</h2>
                <div className="rounded-card overflow-hidden border border-ink/15 h-[300px]">
                  <iframe
                    title="map"
                    className="w-full h-full"
                    loading="lazy"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${p.longitude - 0.01}%2C${p.latitude - 0.008}%2C${p.longitude + 0.01}%2C${p.latitude + 0.008}&layer=mapnik&marker=${p.latitude}%2C${p.longitude}`}
                  />
                </div>
              </div>
            )}
          </div>

          {/* sticky contact card */}
          <aside>
            <div className="bg-ink text-paper rounded-card p-6 md:sticky md:top-6">
              <div className="font-mono text-[10px] uppercase tracking-label text-paper/50 mb-2">{p.listing_type === 'rent' ? t('preview.forRent') : t('preview.forSale')}</div>
              <div className="text-[28px] font-bold tracking-head">{fmtUsd(m.usd, loc)}{rentSfx}</div>
              <div className="text-[15px] font-semibold text-paper/60">{fmtPyg(m.pyg, loc)}{rentSfx}</div>
              <div className="text-paper/60 text-[13px] mt-1 mb-5">{p.city}</div>
              <button className="w-full px-6 py-3.5 bg-paper text-ink font-semibold rounded-pill">{t('preview.contact')}</button>
              {(p.contact_name || p.contact_phone) && (
                <div className="font-mono text-[11px] text-paper/50 mt-3 text-center">{p.contact_name} {p.contact_phone}</div>
              )}
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
