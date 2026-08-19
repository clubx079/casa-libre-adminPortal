import Link from 'next/link';
import { makeT, locale } from '@/lib/i18n';

// Compact template tiles. Clicking one opens the full detail page.
export default function ScrapeBoard({ sources, lang }) {
  const t = makeT(lang);
  return (
    <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {sources.map((s) => (
        <Link
          key={s.key}
          href={`/scrape/${s.key}`}
          className="group bg-card border border-ink/15 rounded-card p-6 cl-lift hover:shadow-hard-sm hover:border-ink flex flex-col"
        >
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-input grid place-items-center shrink-0 font-mono text-[10px] text-ink/45 overflow-hidden ${s.logo_url ? 'bg-card border border-ink/10 p-1.5' : 'cl-hatch'}`}>
              {s.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.logo_url} alt={s.name} className="w-full h-full object-contain" />
              ) : (
                s.key.slice(0, 4).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-[18px] font-bold tracking-head m-0 truncate">{s.name}</h3>
                <span
                  className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill ${
                    s.is_active ? 'bg-ink text-paper' : 'bg-hatch1 text-ink/60'
                  }`}
                >
                  {s.is_active ? t('card.active') : t('card.inactive')}
                </span>
              </div>
              <p className="text-[13px] text-ink/55 mt-1 leading-snug m-0 line-clamp-2">{s.description}</p>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-ink/10 flex items-center justify-between">
            <span className="font-mono text-[10px] text-ink/40">
              {s.last_run_at
                ? `${t('card.lastRun')}: ${new Date(s.last_run_at).toLocaleDateString(locale(lang))}`
                : t('card.neverRun')}
              {s.cron_enabled ? ' · cron ON' : ''}
            </span>
            <span className="text-[13px] font-semibold inline-flex items-center gap-1 group-hover:gap-2 transition-all">
              {t('card.open')} →
            </span>
          </div>
        </Link>
      ))}
      {!sources.length && (
        <div className="col-span-full text-center py-20 text-ink/50">{t('board.empty')}</div>
      )}
    </div>
  );
}
