'use client';
// App installs — how many people install (and remove) the Casa Libre app, per day, on
// Google Play and the App Store. Data: /api/app-installs (store reports, read-only).
// Both stores publish their numbers with a delay (Play ~1–2+ days, Apple ~1–2 days).
import { useEffect, useState } from 'react';
import { T, CARD, Banner, Pill } from '@/components/automations/ui';

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const dayLabel = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const ANDROID = '#111111', IOS = '#8A8478';

function Segmented({ value, options, onChange }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold"
          style={value === v ? { background: T.textPrimary, color: '#fff' } : { color: T.textSecondary }}>{l}</button>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub }) {
  return (
    <div className="rounded-[14px] p-4 min-w-0" style={CARD}>
      <div className="text-[10.5px] font-mono uppercase tracking-label truncate" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[26px] font-bold tracking-head mt-1 tabular-nums" style={{ color: T.textPrimary }}>{value}</div>
      {sub && <div className="text-[11.5px] mt-0.5 truncate" style={{ color: T.textSecondary }}>{sub}</div>}
    </div>
  );
}

// Stacked bars per day: Android (ink) + iPhone (grey), hover for the numbers.
function Chart({ series }) {
  const [hover, setHover] = useState(null);
  const tot = (d) => (d.android || 0) + (d.ios || 0);
  const max = Math.max(1, ...series.map(tot));
  const every = Math.ceil(series.length / 10);
  const h = hover != null ? series[hover] : null;
  return (
    <div>
      <div className="relative h-[200px] flex items-end gap-[2px]">
        {series.map((d, i) => (
          <div key={d.key} className="flex-1 h-full flex flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ opacity: hover == null || hover === i ? 1 : 0.4 }}>
            {d.ios > 0 && <div style={{ height: `${(d.ios / max) * 100}%`, background: IOS }} className="rounded-t-[3px]" />}
            {d.android > 0 && <div style={{ height: `${(d.android / max) * 100}%`, background: ANDROID }} className={d.ios > 0 ? '' : 'rounded-t-[3px]'} />}
            {tot(d) === 0 && <div className="h-[2px]" style={{ background: d.android == null && d.ios == null ? 'transparent' : T.borderLight }} />}
          </div>
        ))}
        {h && (
          <div className="absolute z-10 pointer-events-none rounded-[10px] px-3 py-2 text-[12px] shadow-md whitespace-nowrap"
            style={{ background: T.textPrimary, color: '#fff', top: -6, left: `${((hover + 0.5) / series.length) * 100}%`, transform: `translateX(${hover > series.length * 0.7 ? '-100%' : hover < series.length * 0.3 ? '0' : '-50%'})` }}>
            <div className="font-semibold">{dayLabel(h.key)}</div>
            <div className="opacity-90 tabular-nums">Android {int(h.android)} · iPhone {int(h.ios)}</div>
          </div>
        )}
      </div>
      <div className="flex gap-[2px] mt-1.5">
        {series.map((d, i) => <div key={d.key} className="flex-1 text-[9.5px] text-center truncate" style={{ color: T.textMuted }}>{i % every === 0 ? dayLabel(d.key) : ''}</div>)}
      </div>
      <div className="flex gap-4 mt-3 text-[11.5px]" style={{ color: T.textSecondary }}>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: ANDROID }} />Android (Google Play)</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: IOS }} />iPhone (App Store)</span>
      </div>
    </div>
  );
}

function StoreStatus({ name, s, latest }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[13px] py-2 border-t first:border-t-0" style={{ borderColor: T.borderLight }}>
      <span className="font-semibold" style={{ color: T.textPrimary }}>{name}</span>
      {s.ok
        ? <span style={{ color: T.textSecondary }}>{s.daysWithData ? `Latest day in the report: ${dayLabel(latest)}` : 'Connected — waiting for the first report'} <Pill tone="success">connected</Pill></span>
        : <span className="text-right" style={{ color: T.textSecondary }}>{s.error} <Pill tone="warning">not ready</Pill></span>}
    </div>
  );
}

export default function AppInstallsPage() {
  const [days, setDays] = useState(30);
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = (fresh = false) => {
    setLoading(true);
    fetch(`/api/app-installs?days=${days}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' }).then((r) => r.json()).then(setRes)
      .catch((e) => setRes({ error: String(e) })).finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = res?.total;
  return (
    <div className="space-y-5" data-testid="app-installs-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-bold tracking-head" style={{ color: T.textPrimary }}>App installs</h1>
          <div className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Casa Libre on Google Play and the App Store · numbers arrive 1–2 days late from the stores</div>
        </div>
        <div className="flex items-center gap-3">
          <Segmented value={days} options={PERIODS} onChange={setDays} />
          <button onClick={() => load(true)} disabled={loading} className="text-[12px] font-semibold underline disabled:opacity-50" style={{ color: T.textSecondary }}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {res?.error && <Banner>{res.error}</Banner>}

      {!t ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-5">{Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-[92px] rounded-[14px] animate-pulse" style={{ ...CARD, background: T.bgSurface }} />)}</div>
      ) : (
        <div className={`space-y-5 ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-5">
            <Kpi label="Total installs" value={int(t.android + t.ios)} sub={`last ${res.days} days`} />
            <Kpi label="Android installs" value={res.play.ok ? int(t.android) : '—'} sub={res.play.ok ? `${int(t.androidUninstalls)} uninstalls` : 'not connected'} />
            <Kpi label="Android active devices" value={res.play.ok ? int(t.androidActive) : '—'} sub="devices with the app now" />
            <Kpi label="iPhone installs" value={res.apple.ok ? int(t.ios) : '—'} sub={res.apple.ok ? `${int(t.iosDeletions)} deletions` : 'not connected'} />
            <Kpi label="Net new" value={int(t.android + t.ios - t.androidUninstalls - t.iosDeletions)} sub="installs − removals" />
          </div>
          <div className="rounded-[14px] p-5" style={CARD}>
            <div className="text-[14px] font-bold mb-4" style={{ color: T.textPrimary }}>Installs per day</div>
            <Chart series={res.series} />
          </div>
          <div className="rounded-[14px] px-5 py-3" style={CARD}>
            <StoreStatus name="Google Play" s={res.play} latest={res.latest.play} />
            <StoreStatus name="App Store" s={res.apple} latest={res.latest.apple} />
          </div>
        </div>
      )}
    </div>
  );
}
