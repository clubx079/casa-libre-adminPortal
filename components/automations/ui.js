'use client';
// Shared admin tokens + small pieces for the Email templates and Automations pages
// (same values as the other dashboard pages — see the admin design system).
export const T = {
  primary: '#111111',
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  warning: '#8A5A12',
  warningSurface: '#F5EAD5',
  info: '#2A5B8A',
  infoSurface: '#E1ECF5',
  danger: '#B23A3A',
  dangerSurface: '#F6E4E1',
};
export const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px', background: T.bgWhite };

export const inputCls = 'w-full px-3.5 py-2.5 rounded-input border border-ink/20 bg-card text-[14px] outline-none focus:border-ink/60 transition-colors';

export const fmtDate = (v, withTime = false) => {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('en-US', withTime
      ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }
      : { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return '—'; }
};

export function PageHeader({ title, sub, action }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>{title}</h1>
        {sub ? <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>{sub}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Pill({ tone = 'neutral', children }) {
  const map = {
    success: [T.successSurface, T.success], warning: [T.warningSurface, T.warning], info: [T.infoSurface, T.info],
    danger: [T.dangerSurface, T.danger], neutral: [T.bgSurface, T.textMuted], ink: [T.primary, '#FFFFFF'],
  };
  const [bg, fg] = map[tone] || map.neutral;
  return <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap" style={{ background: bg, color: fg }}>{children}</span>;
}

export function Banner({ tone = 'error', children }) {
  const style = tone === 'warning'
    ? { background: T.warningSurface, color: T.textBody, border: `1px solid ${T.borderLight}` }
    : { background: '#FBEDE9', color: '#8A2B16' };
  return <div className="text-xs px-4 py-3 rounded-[14px]" style={style}>{children}</div>;
}

// Shown when migration 005 hasn't been applied to this country's database yet.
export function PendingMigration() {
  return (
    <Banner tone="warning">
      <b>Not set up for this country yet.</b> Apply <span className="font-mono">migrations/005_automations.sql</span> (buyer portal repo)
      to this country&apos;s database in the AiroBase SQL editor, then reload this page.
    </Banner>
  );
}

export const btnPrimary = 'inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-pill bg-ink text-paper text-[13px] font-semibold shadow-hard-soft disabled:opacity-50 transition-opacity';
export const btnSecondary = 'inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors hover:bg-ink/5 disabled:opacity-50';
