'use client';
// Analytics → Growth: one line chart from the first day with data (lib/growthSeries.js via
// /api/analytics/posthog?type=growth). The thin line is each day; the thick one is the 7-day
// average, so a real drop shows and one quiet day doesn't. Pick the metric (visitors /
// property views / contacted a seller) and the span (all / 90 / 30 days). Hover a day for
// its numbers. Today is still running, so its point is hollow.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { TrendingUp } from 'lucide-react';

const C = {
  ink: '#111111', body: '#3A3A37', secondary: '#6B6862', muted: '#9C978C', border: '#E7E1D6',
  surface: '#FAF7F1', daily: '#C9C2B4', up: '#0F6E56', down: '#B23A3A',
};
const CARD = { border: `1px solid ${C.border}`, borderRadius: '14px' };
const METRICS = [['visitors', 'Visitors'], ['views', 'Property views'], ['contacts', 'Contacted a seller']];
const SPANS = [['all', 'All'], [90, '90 days'], [30, '30 days']];
const H = 240;
const PAD = { l: 44, r: 12, t: 12, b: 28 };
const fmtDay = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const fmtMonth = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' });
const n = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 1 });

// a round top for the y axis
function niceMax(v) {
  if (v <= 5) return 5;
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
}

export default function GrowthChart({ platform = 'web' }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [metric, setMetric] = useState('visitors');
  const [span, setSpan] = useState('all');
  const [hover, setHover] = useState(null);
  const [w, setW] = useState(800);
  const box = useRef(null);

  useEffect(() => {
    let alive = true;
    setData(null); setError('');
    fetch(`/api/analytics/posthog?type=growth&platform=${platform}`).then((r) => r.json())
      .then((j) => { if (!alive) return; if (j.error) setError(j.error); else setData(j); })
      .catch((e) => alive && setError(String(e?.message || e)));
    return () => { alive = false; };
  }, [platform]);

  useEffect(() => {
    if (!box.current) return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const days = useMemo(() => {
    const all = data?.days || [];
    return span === 'all' ? all : all.slice(-Number(span));
  }, [data, span]);

  const chart = useMemo(() => {
    if (days.length < 2) return null;
    const max = niceMax(Math.max(...days.map((d) => Math.max(d[metric], d.avg[metric]))));
    const iw = w - PAD.l - PAD.r;
    const ih = H - PAD.t - PAD.b;
    const x = (i) => PAD.l + (i / (days.length - 1)) * iw;
    const y = (v) => PAD.t + ih - (v / max) * ih;
    const line = (key) => days.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(key(d)).toFixed(1)}`).join('');
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f));
    // x labels: the first day of each month (every other month when the span is long)
    const months = days.map((d, i) => ({ d, i })).filter(({ d, i }) => i === 0 || d.date.endsWith('-01'));
    const step = months.length > 8 ? 2 : 1;
    return { x, y, ih, daily: line((d) => d[metric]), avg: line((d) => d.avg[metric]), ticks, labels: months.filter((_, k) => k % step === 0) };
  }, [days, metric, w]);

  const last = days[days.length - 1];
  const weekAgo = days.length >= 8 ? days[days.length - 8] : null;
  const change = last && weekAgo && weekAgo.avg[metric] ? Math.round(((last.avg[metric] - weekAgo.avg[metric]) / weekAgo.avg[metric]) * 100) : null;
  const today = data?.end;

  const onMove = (e) => {
    if (!chart) return;
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    const i = Math.round(((px - PAD.l) / (w - PAD.l - PAD.r)) * (days.length - 1));
    setHover(i >= 0 && i < days.length ? i : null);
  };
  const hd = hover != null ? days[hover] : null;

  return (
    <div className="bg-white p-5" style={CARD} data-testid="growth-chart">
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <TrendingUp className="w-4 h-4" style={{ color: C.ink }} />
        <h2 className="text-sm font-bold" style={{ color: C.ink }}>Growth</h2>
        <span className="text-[10px]" style={{ color: C.muted }}>
          · per day since {data?.start ? fmtDay(data.start) : '…'}, thick line = 7-day average
        </span>
        <div className="ml-auto flex flex-wrap gap-1.5">
          {METRICS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setMetric(k)} className="text-[11px] px-2.5 py-1 rounded-full"
              style={metric === k ? { background: C.ink, color: '#fff' } : { border: `1px solid ${C.border}`, color: C.body }}>{label}</button>
          ))}
          <span className="w-px mx-1" style={{ background: C.border }} />
          {SPANS.map(([k, label]) => (
            <button key={k} type="button" onClick={() => setSpan(k)} className="text-[11px] px-2.5 py-1 rounded-full"
              style={span === k ? { background: C.ink, color: '#fff' } : { border: `1px solid ${C.border}`, color: C.body }}>{label}</button>
          ))}
        </div>
      </div>

      {last && (
        <p className="text-xs mb-3" style={{ color: C.secondary }}>
          7-day average now <b style={{ color: C.ink }}>{n(last.avg[metric])}</b> a day
          {change != null && (
            <> · <b style={{ color: change >= 0 ? C.up : C.down }}>{change >= 0 ? '+' : ''}{change}%</b> vs a week ago ({n(weekAgo.avg[metric])})</>
          )}
        </p>
      )}

      <div ref={box} className="relative" style={{ height: H }}>
        {error && <p className="text-xs" style={{ color: C.down }}>{error}</p>}
        {!error && !data && <div className="h-full rounded-lg animate-pulse" style={{ background: C.surface }} />}
        {data && !chart && <p className="text-xs" style={{ color: C.muted }}>Not enough days of data yet.</p>}
        {chart && (
          <svg width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={`${METRICS.find(([k]) => k === metric)[1]} per day`}
            onMouseMove={onMove} onMouseLeave={() => setHover(null)} style={{ display: 'block' }}>
            {chart.ticks.map((t) => (
              <g key={t}>
                <line x1={PAD.l} x2={w - PAD.r} y1={chart.y(t)} y2={chart.y(t)} stroke={C.border} strokeWidth="1" />
                <text x={PAD.l - 6} y={chart.y(t) + 3} textAnchor="end" fontSize="10" fill={C.muted}>{n(t)}</text>
              </g>
            ))}
            {chart.labels.map(({ d, i }) => (
              <text key={d.date} x={chart.x(i)} y={H - 8} textAnchor={i === 0 ? 'start' : 'middle'} fontSize="10" fill={C.muted}>{fmtMonth(d.date)}</text>
            ))}
            <path d={chart.daily} fill="none" stroke={C.daily} strokeWidth="1.5" strokeLinejoin="round" />
            <path d={chart.avg} fill="none" stroke={C.ink} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {last?.date === today && (
              <circle cx={chart.x(days.length - 1)} cy={chart.y(last[metric])} r="3.5" fill="#fff" stroke={C.daily} strokeWidth="1.5" />
            )}
            {hd && (
              <g>
                <line x1={chart.x(hover)} x2={chart.x(hover)} y1={PAD.t} y2={PAD.t + chart.ih} stroke={C.muted} strokeDasharray="3 3" />
                <circle cx={chart.x(hover)} cy={chart.y(hd[metric])} r="3.5" fill={C.daily} />
                <circle cx={chart.x(hover)} cy={chart.y(hd.avg[metric])} r="4" fill={C.ink} />
              </g>
            )}
          </svg>
        )}
        {hd && chart && (
          <div className="absolute pointer-events-none bg-white px-3 py-2 text-[11px] shadow-md" data-testid="growth-tip"
            style={{ ...CARD, top: 4, left: Math.min(Math.max(chart.x(hover) + 10, 0), w - 190), width: 180 }}>
            <div className="font-semibold mb-0.5" style={{ color: C.ink }}>{fmtDay(hd.date)}{hd.date === today ? ' (today, so far)' : ''}</div>
            <div style={{ color: C.body }}>That day: <b>{n(hd[metric])}</b></div>
            <div style={{ color: C.body }}>7-day average: <b>{n(hd.avg[metric])}</b></div>
          </div>
        )}
      </div>
    </div>
  );
}
