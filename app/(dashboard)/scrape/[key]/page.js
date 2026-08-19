import { notFound } from 'next/navigation';
import Link from 'next/link';
import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import ScrapeDetail from '@/components/ScrapeDetail';

export const dynamic = 'force-dynamic';

const T = {
  textSecondary: '#6B6862',
};

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
      <div className="space-y-5">
        <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>
          <span className="font-mono">{e.message}</span>
        </div>
      </div>
    );
  }
  if (!source) notFound();

  return (
    <div className="space-y-5">
      <Link href="/scrape" className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: T.textSecondary }}>
        ← {t('detail.back')}
      </Link>
      <ScrapeDetail source={source} lang={lang} />
    </div>
  );
}
