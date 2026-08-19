import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT, locale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const STATUS = {
  success: 'bg-ink text-paper',
  partial: 'bg-hatch1 text-ink',
  failed: 'bg-ink text-paper line-through',
  running: 'bg-transparent text-ink border border-ink/40',
  paused: 'bg-transparent text-ink border border-ink/40',
  stopped: 'bg-hatch1 text-ink/70',
};

export default async function RunsPage() {
  const lang = getLang();
  const t = makeT(lang);
  let runs = [];
  let error = null;
  try {
    runs = await select(
      'scrape_runs',
      'select=id,trigger,status,total_found,inserted_count,updated_count,skipped_count,images_uploaded,started_at,finished_at,scrape_sources(name)&order=started_at.desc&limit=100'
    );
  } catch (e) {
    error = e.message;
  }

  return (
    <div className="p-6 md:p-10">
      <header className="mb-8">
        <div className="font-mono text-xs uppercase tracking-label text-ink/50 mb-2">{t('runs.kicker')}</div>
        <h1 className="text-[clamp(30px,5vw,44px)] tracking-display font-bold m-0">
          {t('runs.title1')} <em className="font-serif italic font-normal">{t('runs.title2')}</em>
        </h1>
      </header>

      {error ? (
        <div className="bg-hatch1 border border-ink/20 rounded-card px-5 py-4 text-sm font-mono">{error}</div>
      ) : (
        <div className="bg-card border border-ink/15 rounded-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse min-w-[720px]">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-label text-ink/50 border-b border-ink/10">
                  <th className="px-4 py-3">{t('runs.tTemplate')}</th>
                  <th className="px-4 py-3">{t('runs.tSource')}</th>
                  <th className="px-4 py-3">{t('runs.tStatus')}</th>
                  <th className="px-4 py-3 text-right">{t('runs.tFound')}</th>
                  <th className="px-4 py-3 text-right">{t('runs.tNew')}</th>
                  <th className="px-4 py-3 text-right">{t('runs.tUpdated')}</th>
                  <th className="px-4 py-3 text-right">{t('runs.tImages')}</th>
                  <th className="px-4 py-3">{t('runs.tWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-ink/[.06]">
                    <td className="px-4 py-3 font-medium">{r.scrape_sources?.name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-ink/60">{r.trigger}</td>
                    <td className="px-4 py-3">
                      <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-pill ${STATUS[r.status] || ''}`}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{r.total_found}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.inserted_count}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.updated_count}</td>
                    <td className="px-4 py-3 text-right font-mono">{r.images_uploaded}</td>
                    <td className="px-4 py-3 font-mono text-[12px] text-ink/55">
                      {r.started_at ? new Date(r.started_at).toLocaleString(locale(lang)) : ''}
                    </td>
                  </tr>
                ))}
                {!runs.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-ink/50">
                      {t('runs.empty')}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
