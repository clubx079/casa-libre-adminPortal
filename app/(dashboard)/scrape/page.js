import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import ScrapeBoard from '@/components/ScrapeBoard';

export const dynamic = 'force-dynamic';

const T = {
  textPrimary: '#111111',
  textSecondary: '#6B6862',
  borderLight: '#E7E1D6',
};

export default async function ScrapePage() {
  const lang = getLang();
  const t = makeT(lang);
  let sources = [];
  let error = null;
  try {
    sources = await select(
      'scrape_sources',
      'select=key,name,description,logo_url,base_url,is_active,filter_schema,default_filters,cron_enabled,cron_schedule,cron_timezone,last_run_at,last_run_status&order=name.asc'
    );
  } catch (e) {
    error = e.message;
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>{t('scrape.title1')} {t('scrape.title2')}</h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>{t('scrape.intro')}</p>
      </div>

      {error ? (
        <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>
          {t('scrape.loadErr')} <span className="font-mono">{error}</span>
          <div className="mt-1" style={{ color: T.textSecondary }}>{t('scrape.migHint')}</div>
        </div>
      ) : (
        <ScrapeBoard sources={sources} lang={lang} />
      )}
    </div>
  );
}
