import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT } from '@/lib/i18n';
import ScrapeBoard from '@/components/ScrapeBoard';

export const dynamic = 'force-dynamic';

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
    <div className="p-6 md:p-10">
      <header className="mb-8">
        <div className="font-mono text-xs uppercase tracking-label text-ink/50 mb-2">{t('scrape.kicker')}</div>
        <h1 className="text-[clamp(30px,5vw,44px)] tracking-display font-bold m-0">
          {t('scrape.title1')} <em className="font-serif italic font-normal">{t('scrape.title2')}</em>
        </h1>
        <p className="text-ink/55 mt-2 max-w-2xl">{t('scrape.intro')}</p>
      </header>

      {error ? (
        <div className="bg-hatch1 border border-ink/20 rounded-card px-5 py-4 text-sm">
          {t('scrape.loadErr')} <span className="font-mono">{error}</span>
          <div className="text-ink/50 mt-1">{t('scrape.migHint')}</div>
        </div>
      ) : (
        <ScrapeBoard sources={sources} lang={lang} />
      )}
    </div>
  );
}
