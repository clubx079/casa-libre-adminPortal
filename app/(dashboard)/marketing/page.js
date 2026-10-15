'use client';
// Marketing — the Google Ads dashboard: spend, clicks, conversions, per day, per campaign,
// keyword and search term, straight from the Google Ads account (read-only, all
// campaigns). Data: /api/marketing/report?parts=ads (lib/marketingReport.js), cached 10
// min. The one-time Google connection setup lives in the small "Connection" panel at
// the bottom (/api/google/status).
import { useEffect, useMemo, useState } from 'react';
import { T, CARD, Banner, Pill, btnPrimary } from '@/components/automations/ui';

const PERIODS = [[7, '7 days'], [30, '30 days'], [90, '90 days']];
const METRICS = [['cost', 'Spend'], ['clicks', 'Clicks'], ['conversions', 'Conversions']];
const money = (v, d = 2) => (v == null ? '—' : `US$${Number(v).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d })}`);
const int = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { maximumFractionDigits: 0 }));
const pct = (v) => (v == null ? '—' : `${Number(v).toFixed(1)}%`);
const dayLabel = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
const fmtMetric = (m, v) => (m === 'cost' ? money(v) : m === 'conversions' ? Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 1 }) : int(v));
const STATUS = { ENABLED: ['success', 'Active'], PAUSED: ['neutral', 'Paused'], REMOVED: ['danger', 'Removed'] };

function Segmented({ value, options, onChange, testid }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }} data-testid={testid}>
      {options.map(([v, l]) => (
        <button key={v} onClick={() => onChange(v)} className="px-3.5 py-1.5 rounded-full text-[12.5px] font-semibold transition-colors"
          style={value === v ? { background: T.textPrimary, color: '#fff' } : { color: T.textSecondary }}>{l}</button>
      ))}
    </div>
  );
}

function Kpi({ label, value, sub, testid }) {
  return (
    <div className="rounded-[14px] p-4 min-w-0" style={CARD} data-testid={testid}>
      <div className="text-[10.5px] font-mono uppercase tracking-label truncate" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[26px] font-bold tracking-head mt-1 tabular-nums truncate" style={{ color: T.textPrimary }}>{value}</div>
      {sub && <div className="text-[11.5px] mt-0.5 truncate" style={{ color: T.textSecondary }}>{sub}</div>}
    </div>
  );
}

function Card({ title, right, children, testid }) {
  return (
    <div className="rounded-[14px] p-5 min-w-0" style={CARD} data-testid={testid}>
      <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="text-[14px] font-bold" style={{ color: T.textPrimary }}>{title}</div>
        {right}
      </div>
      {children}
    </div>
  );
}

// One series per chart (no dual axis): a bar per day, recessive gridlines, hover tooltip.
function DailyChart({ series, metric }) {
  const [hover, setHover] = useState(null);
  const vals = series.map((d) => Number(d[metric]) || 0);
  const max = Math.max(...vals, 0);
  const step = max > 0 ? Math.pow(10, Math.floor(Math.log10(max))) / 2 : 1;
  const top = max > 0 ? Math.ceil(max / step) * step : 1;
  const every = Math.ceil(series.length / 10);
  const h = hover != null ? series[hover] : null;
  return (
    <div data-testid="ads-chart">
      <div className="flex">
        <div className="w-16 relative h-[220px] shrink-0">
          {[0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f} className="absolute right-2 text-[10px] tabular-nums -translate-y-1/2" style={{ bottom: `calc(${f * 100}% - 6px)`, color: T.textMuted }}>{fmtMetric(metric, top * f)}</span>
          ))}
        </div>
        <div className="relative flex-1 h-[220px]">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <div key={f} className="absolute left-0 right-0" style={{ bottom: `${f * 100}%`, borderTop: `1px ${f === 0 ? 'solid' : 'dashed'} ${T.borderLight}` }} />
          ))}
          <div className="absolute inset-0 flex items-end gap-[2px]">
            {series.map((d, i) => (
              <div key={d.key} className="flex-1 h-full flex items-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                <div className="w-full rounded-t-[4px]" style={{ height: `${(vals[i] / top) * 100}%`, minHeight: vals[i] > 0 ? 2 : 0, background: T.textPrimary, opacity: hover == null || hover === i ? 1 : 0.35 }} />
              </div>
            ))}
          </div>
          {h && (
            <div className="absolute z-10 pointer-events-none rounded-[10px] px-3 py-2 text-[12px] shadow-md whitespace-nowrap"
              style={{ background: T.textPrimary, color: '#fff', top: -6, left: `${((hover + 0.5) / series.length) * 100}%`, transform: `translateX(${hover > series.length * 0.7 ? '-100%' : hover < series.length * 0.3 ? '0' : '-50%'})` }}>
              <div className="font-semibold">{dayLabel(h.key)}</div>
              <div className="tabular-nums opacity-90">{money(h.cost)} · {int(h.clicks)} clicks · {fmtMetric('conversions', h.conversions)} conv.</div>
            </div>
          )}
        </div>
      </div>
      <div className="flex gap-[2px] mt-1.5 pl-16">
        {series.map((d, i) => <div key={d.key} className="flex-1 text-[9.5px] text-center truncate" style={{ color: T.textMuted }}>{i % every === 0 ? dayLabel(d.key) : ''}</div>)}
      </div>
    </div>
  );
}

function ShareBar({ value, max }) {
  return <div className="h-1.5 rounded-full mt-1" style={{ background: T.bgSurface }}><div className="h-1.5 rounded-full" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%`, background: T.textPrimary }} /></div>;
}

const th = 'py-2 pr-3 font-medium text-[10.5px] uppercase tracking-label font-mono whitespace-nowrap';
const td = 'py-2.5 pr-3 tabular-nums whitespace-nowrap';

function Connection() {
  const [s, setS] = useState(null);
  const [test, setTest] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetch('/api/google/status').then((r) => r.json()).then(setS).catch(() => setS({})); }, []);
  if (!s) return null;
  const setup = s.setup || {};
  const ok = setup.refreshToken && setup.clientId && setup.clientSecret;
  return (
    <details className="rounded-[14px] px-5 py-3" style={CARD}>
      <summary className="cursor-pointer text-[12.5px] font-semibold" style={{ color: T.textSecondary }}>
        Connection <span className="ml-1"><Pill tone={ok ? 'success' : 'warning'}>{ok ? 'Google connected' : 'Not connected'}</Pill></span>
      </summary>
      <div className="mt-3 space-y-3 text-[12.5px]" style={{ color: T.textBody }}>
        <div className="flex gap-2 flex-wrap">
          {setup.clientId && setup.clientSecret && <a href="/api/google/oauth/start" className={btnPrimary}>{setup.refreshToken ? 'Reconnect Google' : 'Connect Google'}</a>}
          {ok && <button disabled={busy} onClick={async () => { setBusy(true); try { setTest((await (await fetch('/api/google/status?test=1')).json()).test); } finally { setBusy(false); } }} className={btnPrimary} style={{ background: '#fff', color: T.textPrimary, border: `1px solid ${T.textPrimary}` }}>{busy ? 'Testing…' : 'Test connection'}</button>}
        </div>
        {test && <div style={{ color: T.textSecondary }}>Ads {test.ads?.ok ? '✓' : `✗ ${test.ads?.error}`} · Search Console {test.gsc?.ok ? '✓' : '✗'} · Analytics {test.ga4?.ok ? '✓' : '✗'}</div>}
        <div style={{ color: T.textMuted }}>Sign in as omar@airosofts.com. The refresh token is shown once — save it as GOOGLE_ADS_REFRESH_TOKEN and redeploy. Redirect URL: <code>{s.redirectUri}</code></div>
      </div>
    </details>
  );
}

export default function MarketingPage() {
  const [days, setDays] = useState(30);
  const [metric, setMetric] = useState('cost');
  const [res, setRes] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = (fresh = false) => {
    setLoading(true);
    fetch(`/api/marketing/report?parts=ads,own&days=${days}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json()).then(setRes).catch((e) => setRes({ ads: { ok: false, error: String(e) } }))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const a = res?.ads?.ok ? res.ads.data : null;
  const o = res?.own?.ok ? res.own.data : null;
  const t = a?.total;
  const maxCost = useMemo(() => Math.max(0, ...(a?.campaigns || []).map((c) => c.cost)), [a]);
  const softConv = (a?.conversionActions || []).filter((c) => c.soft).reduce((s, c) => s + c.count, 0);
  const maxConv = Math.max(0, ...(a?.conversionActions || []).map((c) => c.count));

  return (
    <div className="space-y-5" data-testid="marketing-page">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[28px] font-bold tracking-head" style={{ color: T.textPrimary }}>Google Ads</h1>
          <div className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>
            Ad account 874-655-0784 · all campaigns{res?.range ? ` · ${dayLabel(res.range.start)} – ${dayLabel(res.range.end)}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Segmented value={days} options={PERIODS} onChange={setDays} testid="ads-period" />
          <button onClick={() => load(true)} disabled={loading} className="text-[12px] font-semibold underline disabled:opacity-50" style={{ color: T.textSecondary }}>{loading ? 'Loading…' : 'Refresh'}</button>
        </div>
      </div>

      {res && !res.ads?.ok && !loading && <Banner>Google Ads: {res.ads?.error}</Banner>}

      {!a ? (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="rounded-[14px] h-[92px] animate-pulse" style={{ ...CARD, background: T.bgSurface }} />)}
        </div>
      ) : (
        <div className={`space-y-5 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6" data-testid="ads-kpis">
            <Kpi label="Spend" value={money(t.cost)} sub={`${money(t.cost / Math.max(1, res.range.days))} per day`} testid="kpi-spend" />
            <Kpi label="Clicks" value={int(t.clicks)} sub={`Avg CPC ${money(t.cpc)}`} />
            <Kpi label="Impressions" value={int(t.impressions)} sub={`CTR ${pct(t.ctr)}`} />
            <Kpi label="Real conversions" value={int(t.realConversions)} sub={t.costPerRealConversion != null ? `${money(t.costPerRealConversion)} each` : 'WhatsApp, call, copy…'} testid="kpi-real" />
            <Kpi label="Google conversions" value={int(t.conversions)} sub={softConv > 0 ? `${int(softConv)} are page views` : `${money(t.costPerConversion)} each`} />
            <Kpi label="Active campaigns" value={int(a.campaigns.filter((c) => c.status === 'ENABLED').length)} sub={`${a.campaigns.length} with activity`} />
          </div>

          {o && (
            <Card title="Customer acquisition" right={<span className="text-[11px]" style={{ color: T.textMuted }}>{(res.country || '').toUpperCase()} · same period · team accounts left out</span>} testid="cac">
              <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
                <div className="rounded-[12px] p-4" style={{ background: T.textPrimary, color: '#fff' }} data-testid="kpi-cac">
                  <div className="text-[10.5px] font-mono uppercase tracking-label opacity-70">CAC · cost per verified sign-up</div>
                  <div className="text-[30px] font-bold tracking-head mt-1 tabular-nums">{money(o.cac)}</div>
                  <div className="text-[11.5px] opacity-80 mt-0.5">{money(o.spend)} ÷ {int(o.verifiedSignups)} verified sign-ups</div>
                </div>
                <Kpi label="Sign-ups" value={int(o.signups)} sub={`${int(o.verifiedSignups)} verified${o.verifiedRate != null ? ` (${o.verifiedRate}%)` : ''}`} />
                <Kpi label="Seller contacts" value={int(o.contacts)} sub={o.costPerContact != null ? `${money(o.costPerContact)} per contact` : 'WhatsApp, call, copy'} />
                <Kpi label="Listings published" value={int(o.listings)} sub={o.costPerListing != null ? `${money(o.costPerListing)} per listing` : 'by owners and agents'} />
              </div>
              <p className="text-[11.5px] mt-3" style={{ color: T.textSecondary }}>Blended: the whole ad spend divided by all verified sign-ups of the period, whatever channel they came from (ads, Google search, direct, WhatsApp). Seller contacts = buyers who tapped WhatsApp / call / copy number on a listing.</p>
            </Card>
          )}

          <Card title="Per day" right={<Segmented value={metric} options={METRICS} onChange={setMetric} testid="ads-metric" />}>
            <DailyChart series={a.series} metric={metric} />
          </Card>

          <Card title="Campaigns" testid="ads-campaigns">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead><tr className="text-left" style={{ color: T.textMuted }}>
                  <th className={th}>Campaign</th><th className={th}>Spend</th><th className={th}>Clicks</th><th className={th}>Impr.</th><th className={th}>CTR</th><th className={th}>Avg CPC</th><th className={th}>Conv.</th>
                </tr></thead>
                <tbody>
                  {a.campaigns.map((c) => {
                    const [tone, lbl] = STATUS[c.status] || ['neutral', c.status];
                    return (
                      <tr key={c.id || c.name} className="border-t" style={{ borderColor: T.borderLight }}>
                        <td className="py-2.5 pr-3 min-w-[220px]"><div className="font-semibold" style={{ color: T.textPrimary }}>{c.name}</div><div className="mt-1"><Pill tone={tone}>{lbl}</Pill></div></td>
                        <td className={`${td} min-w-[140px]`}><span className="font-semibold">{money(c.cost)}</span><ShareBar value={c.cost} max={maxCost} /></td>
                        <td className={td}>{int(c.clicks)}</td><td className={td}>{int(c.impressions)}</td><td className={td}>{pct(c.ctr)}</td><td className={td}>{money(c.cpc)}</td><td className={td}>{fmtMetric('conversions', c.conversions)}</td>
                      </tr>
                    );
                  })}
                  {!a.campaigns.length && <tr><td colSpan={7} className="py-4 text-center" style={{ color: T.textMuted }}>No campaign activity in this period.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid gap-5 lg:grid-cols-2">
            {[['Top keywords', a.keywords, true], ['Top search terms', a.searchTerms, false]].map(([title, rows, isKw]) => {
              const max = Math.max(0, ...rows.map((r) => r.clicks));
              return (
                <Card key={title} title={title} right={<span className="text-[11px]" style={{ color: T.textMuted }}>by clicks</span>}>
                  <table className="w-full text-[13px] table-fixed">
                    <colgroup><col /><col className="w-[64px]" /><col className="w-[88px]" /><col className="w-[64px]" /></colgroup>
                    <thead><tr className="text-left" style={{ color: T.textMuted }}><th className={th}>{isKw ? 'Keyword' : 'Searched'}</th><th className={th}>Clicks</th><th className={th}>Spend</th><th className={th}>CPC</th></tr></thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={i} className="border-t" style={{ borderColor: T.borderLight }}>
                          <td className="py-2 pr-3">
                            <div className="truncate" style={{ color: T.textPrimary }} title={r.text}>{r.text}{isKw && r.match && <span className="ml-1.5 text-[10px] font-mono uppercase" style={{ color: T.textMuted }}>{r.match}</span>}</div>
                            <ShareBar value={r.clicks} max={max} />
                          </td>
                          <td className={td}>{int(r.clicks)}</td><td className={td}>{money(r.cost)}</td><td className={td}>{money(r.cpc)}</td>
                        </tr>
                      ))}
                      {!rows.length && <tr><td colSpan={4} className="py-4 text-center" style={{ color: T.textMuted }}>No data in this period.</td></tr>}
                    </tbody>
                  </table>
                </Card>
              );
            })}
          </div>

          <Card title="What Google counts as a conversion" testid="ads-conversions">
            <div className="space-y-2.5">
              {a.conversionActions.map((c) => (
                <div key={c.name}>
                  <div className="flex items-center justify-between gap-3 text-[13px]">
                    <span style={{ color: T.textBody }}>{c.name} {c.soft && <Pill tone="warning">not a real lead</Pill>}</span>
                    <span className="font-semibold tabular-nums">{fmtMetric('conversions', c.count)}</span>
                  </div>
                  <ShareBar value={c.count} max={maxConv} />
                </div>
              ))}
              {!a.conversionActions.length && <p className="text-[13px]" style={{ color: T.textMuted }}>No conversions in this period.</p>}
            </div>
            {softConv > 0 && <p className="text-[12px] mt-3" style={{ color: T.textSecondary }}>“Page view” is counted as a conversion in Google Ads, so Google’s conversion count and cost per conversion look better than reality. “Real conversions” above leaves it out.</p>}
          </Card>
        </div>
      )}

      <Connection />
    </div>
  );
}
