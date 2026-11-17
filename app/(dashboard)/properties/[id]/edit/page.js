import { notFound } from 'next/navigation';
import Link from 'next/link';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import PropertyEditor from '@/components/PropertyEditor';

export const dynamic = 'force-dynamic';

export default async function EditPropertyPage({ params }) {
  const { select } = dbFor(activeCountry());
  const lang = getLang();
  const t = makeT(lang);

  let property = null;
  try {
    const rows = await select(
      'properties',
      `id=eq.${params.id}&select=*,property_images(id,source_url,storage_url,storage_key,is_feature,position),scrape_sources(name,key)&limit=1`
    );
    property = rows[0] || null;
  } catch (e) {
    return (
      <div className="p-6 md:p-10">
        <div className="bg-hatch1 border border-ink/20 rounded-card px-5 py-4 text-sm font-mono">{e.message}</div>
      </div>
    );
  }
  if (!property) notFound();
  if (Array.isArray(property.property_images)) property.property_images.sort((a, b) => (a.position || 0) - (b.position || 0));

  return (
    <div className="p-6 md:p-10">
      <Link href="/properties" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink/60 hover:text-ink mb-5">
        ← {t('editor.back')}
      </Link>
      {/* User listings: did the seller accept the Listing Agreement (website lib/listingAgreement.js,
          raw_data.listing_agreement) and has its time on the site ended (free or paid)? */}
      {!property.source_id && property.created_by && (() => {
        const ag = property.raw_data?.listing_agreement || null;
        const fl = property.raw_data?.free_listing || null;
        const pl = property.raw_data?.paid_listing || null;
        const d = (s) => (s ? String(s).slice(0, 10) : '');
        return (
          <div className="mb-5 flex flex-wrap gap-2 text-[12.5px] font-mono" data-testid="listing-agreement">
            <span className="px-3 py-1.5 rounded-pill border border-ink/20 bg-card">
              Listing Agreement: {ag ? `accepted ${d(ag.accepted_at)} · v${ag.version}${ag.count > 1 ? ` · ×${ag.count}` : ''}${ag.via ? ` · ${ag.via}` : ''}` : 'not recorded'}
            </span>
            {property.status === 'expired' && (
              <span className="px-3 py-1.5 rounded-pill border border-amber-400 bg-amber-50 text-amber-900">
                Ended{fl?.until || pl?.until ? ` ${d(fl?.until || pl?.until)}` : ''} · {fl && !pl?.until ? 'free listing' : 'paid listing'} · off the site until renewed
              </span>
            )}
          </div>
        );
      })()}
      <PropertyEditor initial={property} lang={lang} />
    </div>
  );
}
