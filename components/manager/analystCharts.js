'use client';
// AI Analyst charts — plain SVG / HTML (no chart library), drawn from the saved data pack via
// lib/analyst/chartData.js. Admin palette: cream paper, ink lines, a few restrained accents.
// Every chart has a hover tooltip; two-series charts have a legend.
import { useEffect, useMemo, useRef, useState } from 'react';
import { T } from '@/components/automations/ui';
import { visitorSeries, sourceBars, funnelSteps, countryBars, fxIndexed } from '@/lib/analyst/chartData';

export const INK = '#111111';
export const PREV = '#CFC6B6';
const GRID = '#EFE9DE';
// outside-event categories (validated categorical set; letters as a second cue)
export const CAT = {
  economy: { color: '#2a78d6', letter: 'E', label: 'Economy' },
  politics: { color: '#6250d6', letter: 'P', label: 'Politics' },
  social: { color: '#1baf7a', letter: 'S', label: 'Social' },
  disaster_climate: { color: '#eb6834', letter: 'D', label: 'Disaster / climate' },
};
const FX_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#e87ba4', '#008300'];
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 }));
const pct = (p) => (p == null ? 'new' : `${p > 0 ? '+' : ''}${p}%`);
const shortDate = (d) => { try { return new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }); } catch { return d; } };

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    if (!ref.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

function Tip({ x, y, width, children }) {
  if (x == null) return null;
  const left = Math.min(Math.max(8, x + 14), width - 236);
  return (
    <div className="absolute z-10 pointer-events-none text-[11.5px] leading-snug px-3 py-2 rounded-lg shadow-md"
      style={{ left, top: Math.max(0, y - 10), width: 228, background: '#FFFFFF', border: `1px solid ${T.borderLight}`, color: T.textBody }}>
      {children}
    </div>
  );
}

function ChartCard({ title, sub, legend, children, className = '' }) {
  return (
    <div className={`bg-white p-4 ${className}`} style={{ border: `1px solid ${T.borderLight}`, borderRadius: 14 }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
        <div>
          <h4 className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{title}</h4>
          {sub ? <p className="text-[11px]" style={{ color: T.textMuted }}>{sub}</p> : null}
        </div>
        {legend}
      </div>
      {children}
    </div>
  );
}

const Swatch = ({ color, label, line, dashed }) => (
  <span className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: T.textSecondary }}>
    {line
      ? <svg width="16" height="6" aria-hidden><line x1="0" y1="3" x2="16" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '3 2' : undefined} /></svg>
      : <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: color }} />}
    {label}
  </span>
);
const TwoLegend = ({ cur = 'This period', prev = 'Previous period' }) => (
  <div className="flex gap-3"><Swatch color={INK} label={cur} /><Swatch color={PREV} label={prev} /></div>
);
export function CatChip({ category }) {
  const c = CAT[category] || { color: T.textMuted, letter: '?', label: category };
  return (
    <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: `${c.color}1A`, color: T.textPrimary }}>
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[8px] text-white" style={{ background: c.color }}>{c.letter}</span>
      {c.label}
    </span>
  );
}

// (a) daily visitors, current period shaded, anomaly days marked, outside events under the line
export function VisitorsChart({ pack }) {
  const s = useMemo(() => visitorSeries(pack), [pack]);
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  if (!s) return null;
  const pts = s.points;
  const H = 250, L = 40, R = 12, TOP = 10, PH = 160, STRIP = 34;
  const max = niceMax(Math.max(...pts.map((p) => p.visitors), 1) * 1.05);
  const step = (W - L - R) / Math.max(1, pts.length - 1);
  const x = (i) => L + i * step;
  const y = (v) => TOP + PH - (v / max) * PH;
  const iCur = pts.findIndex((p) => p.date >= s.periodStart);
  const iPrev = pts.findIndex((p) => p.date >= s.prevStart);
  const path = (from, to) => pts.slice(from, to + 1).map((p, k) => `${k ? 'L' : 'M'}${x(from + k).toFixed(1)},${y(p.visitors).toFixed(1)}`).join('');
  const lastFull = s.partialLastDay ? pts.length - 2 : pts.length - 1;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(pts.length / Math.max(2, Math.floor((W - L) / 64)));
  const cats = [...new Set(pts.flatMap((p) => p.events.map((e) => e.category)))];
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - L) / step);
    setHi(i >= 0 && i < pts.length ? i : null);
  };
  const p = hi != null ? pts[hi] : null;
  return (
    <ChartCard
      title="Visitors per day"
      sub={`Unique visitors. Shaded = this period; amber days = unusual days found in code; dots below = outside events.${s.eventsOutside.length ? ` ${s.eventsOutside.length} older event(s) are listed below the charts.` : ''}`}
      legend={<div className="flex flex-wrap gap-3"><Swatch color={INK} line label="Visitors" />{cats.map((c) => <Swatch key={c} color={CAT[c]?.color} label={CAT[c]?.label || c} />)}</div>}
    >
      <div ref={ref} className="relative">
        <svg width={W} height={H} role="img" aria-label="Visitors per day with outside events" onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ display: 'block' }}>
          {iCur >= 0 ? <rect x={x(iCur) - step / 2} y={TOP} width={W - R - x(iCur) + step / 2} height={PH} fill={T.bgSurface} /> : null}
          {iCur > 0 ? <text x={x(iCur) + 4} y={TOP + 10} fontSize="10" fill={T.textMuted}>this period</text> : null}
          {iPrev > 0 ? <text x={x(iPrev) + 4} y={TOP + 10} fontSize="10" fill={T.textMuted}>previous</text> : null}
          {iPrev > 0 ? <line x1={x(iPrev)} x2={x(iPrev)} y1={TOP} y2={TOP + PH} stroke={GRID} strokeDasharray="3 3" /> : null}
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} />
              <text x={L - 6} y={y(t) + 3} fontSize="10" textAnchor="end" fill={T.textMuted}>{fmt(Math.round(t))}</text>
            </g>
          ))}
          {pts.map((pt, i) => (pt.anomaly ? <rect key={`a${i}`} x={x(i) - Math.max(3, step / 2)} y={TOP} width={Math.max(6, step)} height={PH} fill={T.warningSurface} opacity="0.9" /> : null))}
          <path d={path(0, lastFull)} fill="none" stroke={INK} strokeWidth="2" strokeLinejoin="round" />
          {s.partialLastDay && pts.length > 1 ? <path d={path(pts.length - 2, pts.length - 1)} fill="none" stroke={INK} strokeWidth="2" strokeDasharray="3 3" /> : null}
          {pts.map((pt, i) => (pt.anomaly ? <circle key={`d${i}`} cx={x(i)} cy={y(pt.visitors)} r="4" fill={T.warning} stroke="#fff" strokeWidth="2" /> : null))}
          {/* outside events strip */}
          <line x1={L} x2={W - R} y1={TOP + PH + 0.5} y2={TOP + PH + 0.5} stroke={T.borderLight} />
          {pts.map((pt, i) => pt.events.slice(0, 2).map((e, k) => {
            const c = CAT[e.category] || { color: T.textMuted, letter: '?' };
            return (
              <g key={`e${i}-${k}`}>
                <circle cx={x(i)} cy={TOP + PH + 10 + k * 13} r="6" fill={c.color} stroke="#fff" strokeWidth="1.5" />
                <text x={x(i)} y={TOP + PH + 13 + k * 13} fontSize="7.5" fontWeight="700" textAnchor="middle" fill="#fff">{c.letter}</text>
              </g>
            );
          }))}
          {pts.map((pt, i) => (i % labelEvery === 0 || i === pts.length - 1 ? <text key={`x${i}`} x={x(i)} y={H - 4} fontSize="10" textAnchor={i === 0 ? 'start' : i === pts.length - 1 ? 'end' : 'middle'} fill={T.textMuted}>{shortDate(pt.date)}</text> : null))}
          {p ? (
            <g>
              <line x1={x(hi)} x2={x(hi)} y1={TOP} y2={TOP + PH + STRIP - 8} stroke={T.textMuted} strokeDasharray="2 2" />
              <circle cx={x(hi)} cy={y(p.visitors)} r="4.5" fill={INK} stroke="#fff" strokeWidth="2" />
            </g>
          ) : null}
        </svg>
        {p ? (
          <Tip x={x(hi)} y={y(p.visitors)} width={W}>
            <p className="font-semibold" style={{ color: T.textPrimary }}>{shortDate(p.date)}{s.partialLastDay && hi === pts.length - 1 ? ' (today, partial)' : ''}</p>
            <p>Visitors <b>{fmt(p.visitors)}</b> · sign-ups {fmt(p.signups)} · contacts {fmt(p.contacts)}</p>
            {p.anomaly ? <p className="mt-1" style={{ color: T.warning }}>Unusual: {p.anomaly.map((m) => `${m.metric} ${m.value} vs ${m.baselineAvg7} usual`).join('; ')}</p> : null}
            {p.events.map((e) => <p key={e.id} className="mt-1"><span style={{ color: CAT[e.category]?.color, fontWeight: 700 }}>{CAT[e.category]?.letter || '?'}</span> {e.country} · {e.title}</p>)}
          </Tip>
        ) : null}
      </div>
    </ChartCard>
  );
}

// (b)(d) paired horizontal bars: this period (ink) vs previous (tan), one shared scale
function PairBars({ rows, unit = 'visitor-days' }) {
  const [hi, setHi] = useState(null);
  const max = Math.max(1, ...rows.flatMap((r) => [r.cur, r.prev]));
  return (
    <div className="space-y-2" onMouseLeave={() => setHi(null)}>
      {rows.map((r, i) => (
        <div key={r.key} className="grid items-center gap-2 relative rounded-md px-1 -mx-1" style={{ gridTemplateColumns: 'minmax(84px, 128px) 1fr 52px', background: hi === i ? T.bgSurface : 'transparent' }} onMouseEnter={() => setHi(i)}>
          <span className="text-[12px] truncate" style={{ color: T.textBody }} title={r.label}>{r.label}</span>
          <div className="space-y-[2px]">
            <div className="flex items-center gap-1.5"><div style={{ width: `${(r.cur / max) * 100}%`, minWidth: r.cur ? 2 : 0, height: 8, background: INK, borderRadius: '0 4px 4px 0' }} /><span className="text-[10.5px] tabular-nums" style={{ color: T.textSecondary }}>{fmt(r.cur)}</span></div>
            <div className="flex items-center gap-1.5"><div style={{ width: `${(r.prev / max) * 100}%`, minWidth: r.prev ? 2 : 0, height: 8, background: PREV, borderRadius: '0 4px 4px 0' }} /><span className="text-[10.5px] tabular-nums" style={{ color: T.textMuted }}>{fmt(r.prev)}</span></div>
          </div>
          <span className="text-[11.5px] font-semibold tabular-nums text-right" style={{ color: r.changePct > 0 ? T.success : r.changePct < 0 ? T.danger : T.textMuted }}>{pct(r.changePct)}</span>
          {hi === i ? (
            <div className="absolute z-10 right-0 -top-9 pointer-events-none text-[11.5px] px-3 py-1.5 rounded-lg shadow-md whitespace-nowrap" style={{ background: '#fff', border: `1px solid ${T.borderLight}`, color: T.textBody }}>
              <b style={{ color: T.textPrimary }}>{r.label}</b>: {fmt(r.cur)} vs {fmt(r.prev)} {unit} ({pct(r.changePct)})
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function SourcesChart({ pack }) {
  const rows = useMemo(() => sourceBars(pack), [pack]);
  if (!rows.length) return null;
  return (
    <ChartCard title="Where visitors came from" sub="Visitor-days by first source of the day (country site only)" legend={<TwoLegend />}>
      <PairBars rows={rows} />
    </ChartCard>
  );
}

export function CountriesChart({ pack }) {
  const rows = useMemo(() => countryBars(pack), [pack]);
  if (!rows.length) return null;
  return (
    <ChartCard title="Visitor countries" sub="Visitor-days, top countries and the fastest risers" legend={<TwoLegend />}>
      <PairBars rows={rows} />
    </ChartCard>
  );
}

// (c) conversions: each row scaled to itself (visitors are 100× contacts), with the rate per 1,000
export function FunnelChart({ pack }) {
  const rows = useMemo(() => funnelSteps(pack), [pack]);
  const [hi, setHi] = useState(null);
  if (!rows.length) return null;
  return (
    <ChartCard title="Conversions" sub="Each row on its own scale · rate = per 1,000 unique visitors" legend={<TwoLegend />}>
      <div className="space-y-2.5" onMouseLeave={() => setHi(null)}>
        {rows.map((r, i) => {
          const m = Math.max(1, r.cur, r.prev);
          return (
            <div key={r.key} className="relative rounded-md px-1 -mx-1" style={{ background: hi === i ? T.bgSurface : 'transparent' }} onMouseEnter={() => setHi(i)}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[12px]" style={{ color: T.textBody }}>{r.label}</span>
                <span className="text-[11.5px] tabular-nums" style={{ color: T.textSecondary }}>
                  <b style={{ color: T.textPrimary }}>{fmt(r.cur)}</b> vs {fmt(r.prev)}{' '}
                  <span className="font-semibold" style={{ color: r.changePct > 0 ? T.success : r.changePct < 0 ? T.danger : T.textMuted }}>{pct(r.changePct)}</span>
                </span>
              </div>
              <div className="mt-1 space-y-[2px]">
                <div style={{ width: `${(r.cur / m) * 100}%`, minWidth: r.cur ? 2 : 0, height: 7, background: INK, borderRadius: '0 4px 4px 0' }} />
                <div style={{ width: `${(r.prev / m) * 100}%`, minWidth: r.prev ? 2 : 0, height: 7, background: PREV, borderRadius: '0 4px 4px 0' }} />
              </div>
              {hi === i && r.per1000 != null ? (
                <div className="absolute z-10 right-0 -top-8 pointer-events-none text-[11.5px] px-3 py-1.5 rounded-lg shadow-md whitespace-nowrap" style={{ background: '#fff', border: `1px solid ${T.borderLight}`, color: T.textBody }}>
                  {r.per1000} per 1,000 visitors (was {r.per1000Prev ?? '—'}){r.note ? ` · ${r.note}` : ''}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// (e) exchange rates vs US$, indexed (100 = first day) so all currencies share one axis
export function FxChart({ pack }) {
  const d = useMemo(() => fxIndexed(pack), [pack]);
  const [ref, W] = useWidth();
  const [hi, setHi] = useState(null);
  if (!d) return null;
  const H = 200, L = 40, R = 52, TOP = 10, PH = 160;
  const vals = d.lines.flatMap((l) => l.values).filter((v) => v != null);
  let lo = Math.min(100, ...vals), hiV = Math.max(100, ...vals);
  const pad = Math.max(0.5, (hiV - lo) * 0.15);
  lo -= pad; hiV += pad;
  const n = d.dates.length;
  const step = (W - L - R) / Math.max(1, n - 1);
  const x = (i) => L + i * step;
  const y = (v) => TOP + PH - ((v - lo) / (hiV - lo)) * PH;
  const ticks = [lo + pad, 100, hiV - pad].filter((t, i, a) => a.findIndex((u) => Math.abs(u - t) < (hiV - lo) * 0.08) === i);
  const labelEvery = Math.ceil(n / Math.max(2, Math.floor((W - L) / 64)));
  const onMove = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.round((e.clientX - r.left - L) / step);
    setHi(i >= 0 && i < n ? i : null);
  };
  return (
    <ChartCard title="Exchange rates vs US$" sub="Index, 100 = first day shown · up = local currency weaker"
      legend={<div className="flex flex-wrap gap-3">{d.lines.map((l, i) => <Swatch key={l.key} line color={FX_COLORS[i % FX_COLORS.length]} label={l.key} />)}</div>}>
      <div ref={ref} className="relative">
        <svg width={W} height={H + 16} role="img" aria-label="Exchange rates vs US dollar" onMouseMove={onMove} onMouseLeave={() => setHi(null)} style={{ display: 'block' }}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke={GRID} strokeDasharray={Math.abs(t - 100) < 1e-9 ? '4 3' : undefined} />
              <text x={L - 6} y={y(t) + 3} fontSize="10" textAnchor="end" fill={T.textMuted}>{t.toFixed(1)}</text>
            </g>
          ))}
          {d.lines.map((l, li) => {
            const c = FX_COLORS[li % FX_COLORS.length];
            const segs = l.values.map((v, i) => (v == null ? null : `${x(i).toFixed(1)},${y(v).toFixed(1)}`)).filter(Boolean);
            const lastI = l.values.length - 1 - [...l.values].reverse().findIndex((v) => v != null);
            return (
              <g key={l.key}>
                <polyline points={segs.join(' ')} fill="none" stroke={c} strokeWidth="2" strokeLinejoin="round" />
                <text x={x(lastI) + 6} y={y(l.values[lastI]) + 3} fontSize="10.5" fill={T.textSecondary}>{l.key} {pct(l.changePct)}</text>
              </g>
            );
          })}
          {d.dates.map((dt, i) => (i % labelEvery === 0 || i === n - 1 ? <text key={dt} x={x(i)} y={H + 12} fontSize="10" textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} fill={T.textMuted}>{shortDate(dt)}</text> : null))}
          {hi != null ? <line x1={x(hi)} x2={x(hi)} y1={TOP} y2={TOP + PH} stroke={T.textMuted} strokeDasharray="2 2" /> : null}
        </svg>
        {hi != null ? (
          <Tip x={x(hi)} y={TOP + 20} width={W}>
            <p className="font-semibold" style={{ color: T.textPrimary }}>{shortDate(d.dates[hi])}</p>
            {d.lines.map((l, li) => {
              const raw = pack.outsideWorld.fx.series[l.key]?.[hi];
              return <p key={l.key}><span style={{ color: FX_COLORS[li % FX_COLORS.length], fontWeight: 700 }}>■</span> {l.key} {fmt(raw)} per US$ · index {l.values[hi] ?? '—'}</p>;
            })}
          </Tip>
        ) : null}
      </div>
    </ChartCard>
  );
}

export default function AnalystCharts({ pack }) {
  if (!pack?.sections) return null;
  return (
    <div className="space-y-4">
      <VisitorsChart pack={pack} />
      <div className="grid md:grid-cols-2 gap-4">
        <SourcesChart pack={pack} />
        <FunnelChart pack={pack} />
        <CountriesChart pack={pack} />
        <FxChart pack={pack} />
      </div>
    </div>
  );
}
