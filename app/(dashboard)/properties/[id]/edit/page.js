import { notFound } from 'next/navigation';
import Link from 'next/link';
import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import PropertyEditor from '@/components/PropertyEditor';

export const dynamic = 'force-dynamic';

export default async function EditPropertyPage({ params }) {
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
      <PropertyEditor initial={property} lang={lang} />
    </div>
  );
}
