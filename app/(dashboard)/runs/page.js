import { select } from '@/lib/db';
import { getLang } from '@/lib/lang';
import { makeT, locale } from '@/lib/i18n';

export const dynamic = 'force-dynamic';

const T = {
  textPrimary: '#111111',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const STATUS = {
  success: { background: T.textPrimary, color: T.bgWhite },
  partial: { background: T.bgSurface, color: T.textPrimary },
  failed: { background: T.textPrimary, color: T.bgWhite, textDecoration: 'line-through' },
  running: { background: 'transparent', color: T.textPrimary, border: '1px solid #C9C2B4' },
  paused: { background: 'transparent', color: T.textPrimary, border: '1px solid #C9C2B4' },
  stopped: { background: T.bgSurface, color: T.textSecondary },
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
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>{t('runs.title1')} {t('runs.title2')}</h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>{t('runs.subtitle')}</p>
      </div>

      {error ? (
        <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>
          <span className="font-mono">{error}</span>
        </div>
      ) : (
        <div className="bg-white overflow-hidden" style={CARD}>
          <div className="cl-scroll" style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="w-full min-w-[720px]">
              <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
                <tr>
                  {[t('runs.tTemplate'), t('runs.tSource'), t('runs.tStatus')].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                  ))}
                  {[t('runs.tFound'), t('runs.tNew'), t('runs.tUpdated'), t('runs.tImages')].map((h) => (
                    <th key={h} className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                  ))}
                  <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary, background: T.bgSurface }}>{t('runs.tWhen')}</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3 text-[13px] font-medium" style={{ color: T.textPrimary }}>{r.scrape_sources?.name || '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px]" style={{ color: T.textMuted }}>{r.trigger}</td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={STATUS[r.status] || {}}>
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: T.textPrimary }}>{r.total_found}</td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: T.textPrimary }}>{r.inserted_count}</td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: T.textPrimary }}>{r.updated_count}</td>
                    <td className="px-4 py-3 text-right text-xs" style={{ color: T.textPrimary }}>{r.images_uploaded}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: T.textMuted }}>
                      {r.started_at ? new Date(r.started_at).toLocaleString(locale(lang)) : ''}
                    </td>
                  </tr>
                ))}
                {!runs.length && (
                  <tr>
                    <td colSpan={8} className="px-4 py-16 text-center text-sm" style={{ color: T.textMuted }}>
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
