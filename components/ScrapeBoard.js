import Link from 'next/link';
import { makeT, locale } from '@/lib/i18n';

const T = {
  textPrimary: '#111111',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

// Compact template tiles. Clicking one opens the full detail page.
export default function ScrapeBoard({ sources, lang }) {
  const t = makeT(lang);
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {sources.map((s) => (
        <Link
          key={s.key}
          href={`/scrape/${s.key}`}
          className="bg-white p-5 flex flex-col transition-colors"
          style={CARD}
          onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSurface)}
          onMouseLeave={(e) => (e.currentTarget.style.background = T.bgWhite)}
        >
          <div className="flex items-start gap-3">
            <div
              className="w-11 h-11 shrink-0 flex items-center justify-center overflow-hidden text-[10px] font-semibold"
              style={{ borderRadius: '10px', background: T.bgSurface, color: T.textMuted }}
            >
              {s.logo_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.logo_url} alt={s.name} className="w-full h-full object-contain" />
              ) : (
                s.key.slice(0, 4).toUpperCase()
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold truncate" style={{ color: T.textPrimary }}>{s.name}</h3>
                <span
                  className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0"
                  style={s.is_active ? { background: T.textPrimary, color: T.bgWhite } : { background: T.bgSurface, color: T.textSecondary }}
                >
                  {s.is_active ? t('card.active') : t('card.inactive')}
                </span>
              </div>
              <p className="text-xs mt-1 leading-snug line-clamp-2" style={{ color: T.textSecondary }}>{s.description}</p>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t flex items-center justify-between" style={{ borderColor: T.borderLight }}>
            <span className="text-[11px]" style={{ color: T.textMuted }}>
              {s.last_run_at
                ? `${t('card.lastRun')}: ${new Date(s.last_run_at).toLocaleDateString(locale(lang))}`
                : t('card.neverRun')}
              {s.cron_enabled ? ' · cron ON' : ''}
            </span>
            <span className="text-xs font-semibold" style={{ color: T.textPrimary }}>
              {t('card.open')} →
            </span>
          </div>
        </Link>
      ))}
      {!sources.length && (
        <div className="col-span-full text-center py-16 text-sm" style={{ color: T.textMuted }}>{t('board.empty')}</div>
      )}
    </div>
  );
}
