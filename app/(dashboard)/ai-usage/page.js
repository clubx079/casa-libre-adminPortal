'use client';
// AI usage — what every AI feature costs, for the country picked in the switcher: tokens in / out
// and US$ for Anthropic Claude and Groq, from the admin and the website (ai_usage_log, every call
// logged by lib/aiUsage.js / the website's lib/aiUsage.js). Today / 7 days / 30 days, a daily
// chart, by feature, by provider and model, and the 20 most expensive calls. Read-only.
import { useEffect, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill } from '@/components/automations/ui';

const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' };
// two series, validated for colour-blind separation and contrast on white (dataviz validator)
const SHADE = { anthropic: '#2563B0', groq: '#B8692A' };
const PROVIDER = { anthropic: 'Anthropic Claude', groq: 'Groq' };
const APP = { admin: 'Admin', website: 'Website' };

const usd = (n) => {
  const v = Number(n || 0);
  if (v === 0) return 'US$0';
  if (v < 0.01) return `US$${v.toFixed(4)}`;
  return `US$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const num = (n) => Number(n || 0).toLocaleString('en-US');
const tok = (n) => { const v = Number(n || 0); return v >= 1e6 ? `${(v / 1e6).toFixed(2)}M` : v >= 1e4 ? `${Math.round(v / 1e3)}k` : num(v); };
const dayLabel = (key) => { try { return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return key; } };
const when = (iso) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return iso; } };

function Kpi({ label, t, testid }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD} data-testid={testid}>
      <div className="text-[11px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[24px] font-bold tracking-head mt-1" style={{ color: T.textPrimary }}>{usd(t.cost)}</div>
      <div className="text-[11.5px] mt-0.5" style={{ color: T.textSecondary }}>
        {num(t.calls)} calls · {tok(t.input + t.cacheRead + t.cacheWrite)} in · {tok(t.output)} out{t.failed ? ` · ${t.failed} failed` : ''}
      </div>
    </div>
  );
}

// Daily cost, one bar per day, stacked by provider (2px gap between segments, rounded top).
function Chart({ daily }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(...daily.map((d) => d.cost), 0);
  if (!max) return <p className="text-[13px]" style={{ color: T.textMuted }}>No AI calls logged in the last 30 days.</p>;
  const h = hover != null ? daily[hover] : null;
  return (
    <div>
      <div className="h-5 text-[12px] mb-1" style={{ color: T.textSecondary }} aria-live="polite">
        {h ? <><b style={{ color: T.textPrimary }}>{dayLabel(h.key)}</b> · {usd(h.cost)} · {num(h.calls)} calls · Claude {usd(h.byProvider.anthropic)} · Groq {usd(h.byProvider.groq)}</> : `Highest day: ${usd(max)}`}
      </div>
      <div className="flex items-end gap-[3px] h-[180px] border-b" style={{ borderColor: T.borderLight }} data-testid="ai-chart" role="img" aria-label="Daily AI cost for the last 30 days, Anthropic and Groq">
        {daily.map((d, i) => (
          <div key={d.key} className="flex-1 min-w-[6px] h-full flex flex-col justify-end cursor-default" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${dayLabel(d.key)}: ${usd(d.cost)}`}>
            {['groq', 'anthropic'].map((p, j) => d.byProvider[p] > 0 && (
              <div key={p} style={{ height: `${(d.byProvider[p] / max) * 100}%`, background: SHADE[p], minHeight: 2, marginTop: j === 1 && d.byProvider.groq > 0 ? 2 : 0, borderRadius: (p === 'groq' || !d.byProvider.groq) ? '4px 4px 0 0' : 0, opacity: hover == null || hover === i ? 1 : 0.55 }} />
            ))}
          </div>
        ))}
      </div>
      <div className="flex gap-[3px] mt-1">
        {daily.map((d, i) => <div key={d.key} className="flex-1 min-w-[6px] text-[9.5px] text-center whitespace-nowrap overflow-visible" style={{ color: T.textMuted }}>{i % 5 === 0 || i === daily.length - 1 ? dayLabel(d.key) : ''}</div>)}
      </div>
      <div className="flex flex-wrap gap-4 mt-3">
        {['anthropic', 'groq'].map((p) => <span key={p} className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: T.textSecondary }}><span className="w-2.5 h-2.5 rounded-sm" style={{ background: SHADE[p] }} />{PROVIDER[p]}</span>)}
      </div>
    </div>
  );
}

const th = 'py-2 pr-3 font-medium';
const thr = `${th} text-right`;
const td = 'py-2 pr-3 text-right tabular-nums';

export default function AiUsagePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetch('/api/ai-usage', { cache: 'no-store' }).then((r) => r.json()).then((j) => (j.error && !j.missing ? setErr(j.error) : setData(j))).catch((e) => setErr(String(e))); }, []);

  if (err) return <Banner>{err}</Banner>;
  if (!data) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading AI usage…</div>;
  const country = COUNTRY_NAME[data.country] || String(data.country || '').toUpperCase();
  const label = (f) => data.labels?.[f] || f;

  return (
    <div className="space-y-6" data-testid="ai-usage-page">
      <PageHeader title="AI usage" sub={`${country} — tokens and cost of every AI call (Anthropic Claude and Groq) by the admin and the website. Switch country at the top to see another.`} action={<Pill tone="ink">{country}</Pill>} />

      {data.missing ? (
        <Banner tone="warning">
          <b>Not set up for this country yet.</b> Run <span className="font-mono">migrations/010_ai_usage_log.sql</span> (admin repo; the same file is the website&apos;s <span className="font-mono">migrations/021_ai_usage_log.sql</span>) in this country&apos;s database in the AiroBase SQL editor. Until then AI calls work as usual but are not logged.
        </Banner>
      ) : (
        <>
          <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
            <Kpi testid="k-today" label="Today" t={data.totals.today} />
            <Kpi testid="k-7d" label="Last 7 days" t={data.totals.d7} />
            <Kpi testid="k-30d" label="Last 30 days" t={data.totals.d30} />
          </div>

          <div className="rounded-[14px] p-5" style={CARD}>
            <div className="text-[15px] font-bold mb-2" style={{ color: T.textPrimary }}>Cost per day</div>
            <Chart daily={data.daily} />
          </div>

          <div className="rounded-[14px] p-5" style={CARD} data-testid="ai-by-feature">
            <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>By feature · last 30 days</div>
            {data.byFeature.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>No calls yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left" style={{ color: T.textMuted }}><th className={th}>Feature</th><th className={th}>App</th><th className={th}>Provider</th><th className={thr}>Calls</th><th className={thr}>Input tokens</th><th className={thr}>Output tokens</th><th className="py-2 font-medium text-right">Cost</th></tr></thead>
                  <tbody>
                    {data.byFeature.map((f) => (
                      <tr key={`${f.app}${f.feature}`} className="border-t" style={{ borderColor: T.borderLight }}>
                        <td className="py-2 pr-3" title={f.feature}>{label(f.feature)}</td>
                        <td className="py-2 pr-3" style={{ color: T.textSecondary }}>{APP[f.app] || f.app}</td>
                        <td className="py-2 pr-3" style={{ color: T.textSecondary }}>{f.providers.map((p) => PROVIDER[p] || p).join(', ')}</td>
                        <td className={td}>{num(f.calls)}{f.failed ? <span style={{ color: T.danger }}> ({f.failed} failed)</span> : null}</td>
                        <td className={td} title={`uncached ${num(f.input)} · cache read ${num(f.cacheRead)} · cache write ${num(f.cacheWrite)}`}>{num(f.input + f.cacheRead + f.cacheWrite)}</td>
                        <td className={td}>{num(f.output)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{usd(f.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-[14px] p-5" style={CARD} data-testid="ai-by-model">
            <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>By provider and model · last 30 days</div>
            {data.byModel.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>No calls yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left" style={{ color: T.textMuted }}><th className={th}>Provider</th><th className={th}>Model</th><th className={thr}>Calls</th><th className={thr}>Input</th><th className={thr}>Cache read</th><th className={thr}>Cache write</th><th className={thr}>Output</th><th className="py-2 font-medium text-right">Cost</th></tr></thead>
                  <tbody>
                    {data.byModel.map((m) => (
                      <tr key={`${m.provider}${m.model}`} className="border-t" style={{ borderColor: T.borderLight }}>
                        <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: SHADE[m.provider] || T.textMuted }} />{PROVIDER[m.provider] || m.provider}</span></td>
                        <td className="py-2 pr-3 font-mono text-[12px]">{m.model}{!m.priced && <span className="ml-1.5" style={{ color: T.warning }} title="No price in lib/aiPricing.js: cost counted as 0">· no price</span>}</td>
                        <td className={td}>{num(m.calls)}</td><td className={td}>{num(m.input)}</td><td className={td}>{num(m.cacheRead)}</td><td className={td}>{num(m.cacheWrite)}</td><td className={td}>{num(m.output)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{usd(m.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="rounded-[14px] p-5" style={CARD} data-testid="ai-top">
            <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>The 20 most expensive calls · last 30 days</div>
            {data.top.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>No calls yet.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead><tr className="text-left" style={{ color: T.textMuted }}><th className={th}>When</th><th className={th}>Feature</th><th className={th}>Model</th><th className={thr}>Input</th><th className={thr}>Output</th><th className="py-2 font-medium text-right">Cost</th></tr></thead>
                  <tbody>
                    {data.top.map((c, i) => (
                      <tr key={c.id ?? i} className="border-t" style={{ borderColor: T.borderLight }}>
                        <td className="py-2 pr-3 whitespace-nowrap" style={{ color: T.textSecondary }}>{when(c.created_at)}</td>
                        <td className="py-2 pr-3" title={c.ref || ''}>{label(c.feature)} <span style={{ color: T.textMuted }}>· {APP[c.app] || c.app}</span>{!c.ok && <span style={{ color: T.danger }}> · failed</span>}</td>
                        <td className="py-2 pr-3 font-mono text-[12px]">{c.model}</td>
                        <td className={td}>{num(c.input + c.cacheRead + c.cacheWrite)}</td><td className={td}>{num(c.output)}</td>
                        <td className="py-2 text-right font-semibold tabular-nums">{usd(c.cost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      <div className="rounded-[14px] p-5" style={CARD} data-testid="ai-prices">
        <div className="text-[15px] font-bold mb-1" style={{ color: T.textPrimary }}>Prices used (US$ per million tokens)</div>
        <p className="text-[12px] mb-3" style={{ color: T.textMuted }}>Set in code (lib/aiPricing.js, and the website&apos;s copy). Each call is priced when it is logged.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: T.textMuted }}><th className={th}>Model</th><th className={thr}>Input</th><th className={thr}>Output</th><th className={thr}>Cache read</th><th className={thr}>Cache write</th><th className="py-2 font-medium">Source</th></tr></thead>
            <tbody>{(data.prices || []).map((p) => (
              <tr key={p.model} className="border-t" style={{ borderColor: T.borderLight }}>
                <td className="py-2 pr-3 font-mono text-[12px]">{p.model}</td><td className={td}>{p.input}</td><td className={td}>{p.output}</td><td className={td}>{p.cacheRead}</td><td className={td}>{p.cacheWrite}</td>
                <td className="py-2 text-[12px]" style={{ color: T.textSecondary }}>{p.source}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
