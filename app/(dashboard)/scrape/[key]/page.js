import { notFound } from 'next/navigation';
import Link from 'next/link';
import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import ScrapeDetail from '@/components/ScrapeDetail';

export const dynamic = 'force-dynamic';

export default async function SourceDetailPage({ params }) {
  const lang = getLang();
  const t = makeT(lang);

  let source = null;
  try {
    const rows = await select(
      'scrape_sources',
      `key=eq.${encodeURIComponent(params.key)}&select=key,name,description,logo_url,base_url,is_active,filter_schema,default_filters,cron_enabled,cron_schedule,cron_timezone,last_run_at,last_run_status&limit=1`
    );
    source = rows[0] || null;
  } catch (e) {
    return (
      <div className="p-6 md:p-10">
        <div className="bg-hatch1 border border-ink/20 rounded-card px-5 py-4 text-sm font-mono">{e.message}</div>
      </div>
    );
  }
  if (!source) notFound();

  return (
    <div className="p-6 md:p-10">
      <Link href="/scrape" className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink/60 hover:text-ink mb-5">
        ← {t('detail.back')}
      </Link>
      <ScrapeDetail source={source} lang={lang} />
    </div>
  );
}
