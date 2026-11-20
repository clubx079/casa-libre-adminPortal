'use client';
// Admin Manager → AI SEO → "Results of our changes": every page the AI SEO added or edited, with Google
// BEFORE the change vs AFTER it (per-day averages, so short and long periods compare fairly) and the %
// change. Data: GET /api/manager/seo?impact=1[&site=<key>] (lib/seo/impact.js + impactData.js).
import { useEffect, useState } from 'react';
import { T, CARD, Pill, Banner, fmtDate } from '@/components/automations/ui';

const withSite = (url, siteKey) => (siteKey ? `${url}${url.includes('?') ? '&' : '?'}site=${encodeURIComponent(siteKey)}` : url);
const n = (v, d = 1) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: d }));
const pos = (v) => (v == null ? '—' : Number(v).toFixed(1));
const color = (v) => (v == null || v === 0 ? T.textMuted : v > 0 ? T.success : T.danger);
const pctText = (v) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}%`);
const STATUS = { measured: ['success', 'Measured'], 'too early': ['warning', 'Too early'], waiting: ['neutral', 'Waiting for Google data'] };

function Tile({ label, value, sub, tone }) {
  return (
    <div className="rounded-[12px] px-4 py-3" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
      <div className="text-[12px]" style={{ color: T.textSecondary }}>{label}</div>
      <div className="text-[22px] font-bold tabular-nums mt-0.5" style={{ color: tone || T.textPrimary }}>{value}</div>
      {sub ? <div className="text-[11.5px] mt-0.5" style={{ color: T.textSecondary }}>{sub}</div> : null}
    </div>
  );
}

function Window({ w }) {
  if (!w) return <span style={{ color: T.textMuted }}>—</span>;
  return (
    <div className="tabular-nums leading-snug">
      <div>{n(w.perDay.impressions)} <span style={{ color: T.textMuted }}>views/day</span></div>
      <div>{n(w.perDay.clicks, 2)} <span style={{ color: T.textMuted }}>clicks/day</span></div>
      <div style={{ color: T.textSecondary }}>pos {pos(w.position)} · {w.days} days</div>
    </div>
  );
}

export default function SeoImpact({ siteKey = null }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    fetch(withSite('/api/manager/seo?impact=1', siteKey)).then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else setData(j.impact); }).catch(() => setErr('Could not load the results. Reload the page to try again.'));
  }, [siteKey]);

  if (err) return <Banner>{err}</Banner>;
  if (!data) return <p className="text-[13px]" style={{ color: T.textMuted }}>Loading Google data for every changed page…</p>;
  const pages = data.pages || [];
  const ed = data.edited; const nw = data.new;
  const link = (p) => (data.origin ? `${data.origin}${p}` : null);

  return (
    <div className="space-y-4">
      <section className="p-5" style={CARD}>
        <h2 className="text-[15px] font-bold" style={{ color: T.textPrimary }}>Results of our changes</h2>
        <p className="text-[12px] mt-0.5 max-w-3xl" style={{ color: T.textSecondary }}>
          Every page the AI SEO added or edited in the last 90 days, with Google before the change and after it. Numbers are per day,
          so a short &ldquo;after&rdquo; compares fairly with the 14 days before. Google&apos;s data arrives 2–3 days late (last day: {data.lastDay}),
          and changes under 7 days old are marked &ldquo;too early&rdquo;.
        </p>
        {data.error ? <div className="mt-3"><Banner tone="warning">Google data not available: {data.error}</Banner></div> : null}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
          <Tile label="Pages changed" value={n(pages.length, 0)} sub={`${n(ed?.pages || 0, 0)} edited · ${n(nw?.pages || 0, 0)} new`} />
          <Tile label="Edited pages: Google views per day" value={ed ? pctText(ed.change.impressionsPct) : '—'} tone={ed ? color(ed.change.impressionsPct) : undefined} sub={ed ? `${n(ed.before.impressions)} before → ${n(ed.after.impressions)} after` : 'No edited page with data yet'} />
          <Tile label="Edited pages: clicks per day" value={ed ? pctText(ed.change.clicksPct) : '—'} tone={ed ? color(ed.change.clicksPct) : undefined} sub={ed ? `${n(ed.before.clicks, 2)} before → ${n(ed.after.clicks, 2)} after` : '—'} />
          <Tile label="New pages: seen in Google" value={nw ? `${n(nw.withImpressions, 0)} of ${n(nw.pages, 0)}` : '—'} sub={nw ? `${n(nw.after.impressions, 0)} views · ${n(nw.after.clicks, 0)} clicks since added` : 'No new pages yet'} />
        </div>
      </section>

      {!pages.length ? <p className="text-[13px]" style={{ color: T.textMuted }}>No page has been added or edited yet. Results appear here after the first changes.</p> : (
        <div className="overflow-x-auto" style={CARD}>
          <table className="w-full text-xs min-w-[980px]">
            <thead><tr className="border-b" style={{ borderColor: T.borderLight }}>
              {['Page', 'What we did', 'Changed', 'Before (14 days)', 'After', 'Views', 'Clicks', 'Position', 'Status'].map((h, i) => (
                <th key={h} className={`px-3 py-2 font-semibold ${i >= 5 && i <= 7 ? 'text-right' : 'text-left'}`} style={{ color: T.textMuted }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>{pages.map((p) => {
              const [tone, label] = STATUS[p.status] || STATUS.waiting;
              const href = link(p.path);
              return (
                <tr key={p.path} className="border-t align-top" style={{ borderColor: T.borderLight }}>
                  <td className="px-3 py-2.5 max-w-[280px] break-words font-mono text-[11px]">{href ? <a href={href} target="_blank" rel="noreferrer" className="underline decoration-black/20 hover:decoration-black" style={{ color: T.textPrimary }}>{p.path}</a> : p.path}</td>
                  <td className="px-3 py-2.5" style={{ color: T.textBody }}>{p.kinds.join(', ')}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: T.textBody }}>{fmtDate(p.firstChange)}<div className="text-[11px]" style={{ color: T.textMuted }}>{p.afterDays} days of data after</div></td>
                  <td className="px-3 py-2.5">{p.isNew ? <span style={{ color: T.textMuted }}>New page</span> : <Window w={p.before} />}</td>
                  <td className="px-3 py-2.5"><Window w={p.after} /></td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: color(p.change?.impressionsPct) }}>{p.isNew ? n(p.after?.impressions, 0) : pctText(p.change?.impressionsPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: color(p.change?.clicksPct) }}>{p.isNew ? n(p.after?.clicks, 0) : pctText(p.change?.clicksPct)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold" style={{ color: color(p.change?.positionGain) }}>{p.isNew ? pos(p.after?.position) : p.change?.positionGain == null ? '—' : p.change.positionGain >= 0 ? `▲ ${p.change.positionGain}` : `▼ ${-p.change.positionGain}`}</td>
                  <td className="px-3 py-2.5"><Pill tone={tone}>{label}</Pill></td>
                </tr>
              );
            })}</tbody>
          </table>
          <p className="text-[11.5px] px-3 py-2.5" style={{ color: T.textMuted, borderTop: `1px solid ${T.borderLight}` }}>
            Edited pages show the change in views, clicks and position per day (▲ = higher in Google). New pages show their total views, clicks and position since they were added.
          </p>
        </div>
      )}
    </div>
  );
}
