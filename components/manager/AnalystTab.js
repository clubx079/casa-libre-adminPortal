'use client';
// Admin Manager → "AI Analyst": pick a country (or all) and a period, run the analysis, read why
// the numbers moved. Layout: summary + what to do next → charts (components/manager/analystCharts.js)
// → what changed (each finding with its evidence and confidence) → outside world (timeline with
// the model's verdict) → details. Data: /api/manager/analyst (lib/analyst/*). Runs are kept by
// the server (memory + local file), not in the database.
import { useCallback, useEffect, useRef, useState } from 'react';
import { T, CARD, Pill, Banner, fmtDate, btnPrimary, btnSecondary } from '@/components/automations/ui';
import AnalystCharts, { CatChip } from '@/components/manager/analystCharts';

const COUNTRIES = [['py', 'Paraguay'], ['bo', 'Bolivia'], ['uy', 'Uruguay'], ['ve', 'Venezuela'], ['sv', 'El Salvador']];
const CHANNEL_LABEL = {
  organic_google: 'Organic Google', google_ads: 'Google Ads', ai_search: 'ChatGPT / AI search', whatsapp: 'WhatsApp',
  email: 'Email', social: 'Facebook / social', funnels: 'Funnel sites', hub: 'casa-libre.com hub', direct_other: 'Direct & other',
};
const STAGE = {
  collect: 'Collecting the numbers (PostHog, Search Console, Google Ads, sends, bot signals)…',
  outside: 'Building the outside-world timeline (exchange rates, holidays, disasters, weather, news search)…',
  search: 'Looking up outside events…',
  analyze: 'Claude is reading everything…',
};
const TONE = { high: 'danger', medium: 'warning', low: 'neutral' };
const TREND = { up: ['success', 'Up'], down: ['danger', 'Down'], flat: ['neutral', 'Flat'], new: ['info', 'New'], no_data: ['neutral', 'No data'] };
const CONF = { strong: ['success', 'Strong'], possible: ['warning', 'Possible'], guess: ['neutral', 'Guess'] };
const VERDICT = { working: ['success', 'Working'], not_working: ['danger', 'Not working'], watch: ['info', 'Watch'], noise: ['neutral', 'Noise'] };
const EFFECT = { plausible: ['warning', 'Plausibly affected us'], unlikely: ['neutral', 'Unlikely'], no_visible_effect: ['neutral', 'No visible effect'] };
const SRC_LABEL = {
  site_analytics: 'Site analytics', funnel_sites: 'Funnel sites', hub: 'Hub', search_console: 'Search Console', google_ads: 'Google Ads', our_sends: 'Our sends',
  funnel_leads: 'Funnel leads', bot_signals: 'Bot signals', anomalies: 'Unusual days', outside_world: 'Outside world', exchange_rates: 'Exchange rates',
};
const EV_SOURCE = { fx: 'exchange rates', holidays: 'public holidays', gdacs: 'GDACS', weather: 'Open-Meteo', web_search: 'web search' };
const countryName = (cc) => (cc === 'all' ? 'All countries' : (COUNTRIES.find(([c]) => c === cc) || [cc, cc.toUpperCase()])[1]);
const fmtN = (v, unit = '') => (v == null ? '—' : `${unit === 'US$' ? 'US$' : ''}${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const pctTxt = (p) => (p == null ? 'new' : `${p > 0 ? '+' : ''}${p}%`);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return 'source'; } };

function Card({ title, children, right, sub }) {
  return (
    <div className="bg-white p-5" style={CARD}>
      {title ? (
        <div className="flex items-center justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: T.textPrimary }}>{title}</h3>
            {sub ? <p className="text-[11.5px]" style={{ color: T.textMuted }}>{sub}</p> : null}
          </div>
          {right}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function SmallTable({ head, rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead><tr style={{ color: T.textMuted }}>{head.map((h, i) => <th key={`${h}${i}`} className={`py-1.5 pr-3 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t" style={{ borderColor: T.borderLight }}>
              {r.map((c, j) => <td key={j} className={`py-1.5 pr-3 ${j ? 'text-right tabular-nums' : ''}`} style={{ color: T.textBody }}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const Label = ({ children }) => <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.textMuted }}>{children}</p>;

function Collapsible({ title, sub, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-white" style={CARD}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-5 py-3.5 text-left">
        <span className="text-sm font-semibold" style={{ color: T.textPrimary }}>{title}</span>
        <span className="text-xs" style={{ color: T.textMuted }}>{open ? 'Hide' : 'Show'}{sub ? ` · ${sub}` : ''}</span>
      </button>
      {open ? <div className="px-5 pb-5 space-y-5 border-t pt-4" style={{ borderColor: T.borderLight }}>{children}</div> : null}
    </div>
  );
}

function Changes({ items }) {
  return (
    <Card title="What changed" sub="What the data shows, then the possible explanation. Every number is checked against the data in code.">
      <div className="divide-y" style={{ borderColor: T.borderLight }}>
        {items.map((c, i) => {
          const [ct, cl] = CONF[c.confidence] || CONF.guess;
          const [vt, vl] = VERDICT[c.verdict] || VERDICT.watch;
          return (
            <div key={i} className="py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[13.5px] font-semibold" style={{ color: T.textPrimary }}>{c.title}</p>
                <Pill tone={ct}>{cl}</Pill><Pill tone={vt}>{vl}</Pill>
              </div>
              <p className="text-[12px] mt-0.5" style={{ color: T.textMuted }}>{c.metric} · {c.when} · <span className="tabular-nums font-semibold" style={{ color: c.direction === 'up' ? T.success : c.direction === 'down' ? T.danger : T.textSecondary }}>{c.change}</span></p>
              <p className="text-[13px] mt-1.5" style={{ color: T.textBody }}><b>Data shows:</b> {c.dataShows}</p>
              <ul className="mt-1 space-y-0.5">
                {(c.evidence || []).map((e, j) => (
                  <li key={j} className="text-[12px] flex gap-2" style={{ color: T.textSecondary }}>
                    <span title={e.inData === false ? `Not found in the data: ${(e.notInData || []).join(', ')}` : e.inData ? 'Numbers found in the data' : 'No numbers to check'}
                      style={{ color: e.inData === false ? T.danger : e.inData ? T.success : T.textMuted }}>{e.inData === false ? '✕' : e.inData ? '✓' : '·'}</span>
                    <span><span style={{ color: T.textMuted }}>{SRC_LABEL[e.source] || e.source} · {e.metric} · {e.period}:</span> {e.value}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[13px] mt-1.5" style={{ color: T.textBody }}><b>Possible explanation:</b> {c.explanation}</p>
              {c.guardNote ? <p className="text-[11.5px] mt-1" style={{ color: T.warning }}>{c.guardNote}</p> : null}
            </div>
          );
        })}
      </div>
    </Card>
  );
}

function OutsideWorld({ pack, verdicts }) {
  const ow = pack.outsideWorld || {};
  const events = ow.events || [];
  const byId = new Map((verdicts || []).map((v) => [v.eventId, v]));
  const [showAll, setShowAll] = useState(false);
  const assessed = events.filter((e) => byId.has(e.id));
  const rest = events.filter((e) => !byId.has(e.id));
  const shown = showAll ? [...assessed, ...rest] : assessed.length ? assessed : rest.slice(0, 8);
  return (
    <Card title="Outside world" sub={ow.window ? `${ow.window.start} → ${ow.window.end} · ${(ow.countries || []).map((c) => c.name).join(', ')}` : ''}
      right={events.length > shown.length || showAll ? <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }} onClick={() => setShowAll((s) => !s)}>{showAll ? 'Only the assessed ones' : `All ${events.length} events`}</button> : null}>
      {ow.error ? <p className="text-xs" style={{ color: T.danger }}>Could not build the timeline: {ow.error}</p> : null}
      {!events.length && !ow.error ? <p className="text-xs" style={{ color: T.textMuted }}>No outside events found for this period.</p> : null}
      <ul className="divide-y" style={{ borderColor: T.borderLight }}>
        {shown.map((e) => {
          const v = byId.get(e.id);
          const [et, el] = v ? EFFECT[v.effect] || EFFECT.unlikely : ['neutral', 'Not assessed'];
          return (
            <li key={e.id} className="py-2.5 first:pt-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] font-semibold tabular-nums" style={{ color: T.textPrimary }}>{e.date}</span>
                <CatChip category={e.category} />
                <span className="text-[11px]" style={{ color: T.textMuted }}>{e.country} · {EV_SOURCE[e.source] || e.source}</span>
                <Pill tone={et}>{el}</Pill>
              </div>
              <p className="text-[13px] mt-1" style={{ color: T.textBody }}>
                {e.title}{e.url ? <> · <a href={e.url} target="_blank" rel="noreferrer" className="underline" style={{ color: T.info }}>{host(e.url)}</a></> : null}
              </p>
              {e.detail && e.source === 'web_search' ? <p className="text-[12px]" style={{ color: T.textSecondary }}>{e.detail}</p> : null}
              {v ? <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}><b>Effect on us{v.lag && v.lag !== 'none' ? ` (${v.lag})` : ''}:</b> {v.reasoning}</p> : null}
            </li>
          );
        })}
      </ul>
      {(ow.errors || []).length ? <p className="text-[11px] mt-2" style={{ color: T.textMuted }}>Not available: {ow.errors.join('; ')}</p> : null}
    </Card>
  );
}

const BOT_V = { automated_likely: ['danger', 'Automated likely'], mixed: ['warning', 'Mixed'], human_like: ['success', 'Real people'], too_small: ['neutral', 'Too small'] };
function BotTable({ b }) {
  if (!b) return null;
  if (b.error) return <p className="text-xs" style={{ color: T.danger }}>Bot signals unavailable: {b.error}</p>;
  const row = (r) => {
    const [tone, label] = BOT_V[r.verdict] || BOT_V.too_small;
    return [r.key, fmtN(r.visitorDays), `${r.oneEventOnlyPct ?? '—'}%`, `${r.under5sPct ?? '—'}%`, fmtN(r.pageviewsPerVisit), `${r.medianSeconds ?? '—'}s`, `${r.topDeviceSharePct ?? '—'}%`, `${r.topNetworkSharePct ?? '—'}%`, <Pill key="v" tone={tone}>{label}</Pill>];
  };
  const head = ['', 'Visits', '1 event', '< 5 s', 'Pages/visit', 'Median', 'Top device', 'Top network', 'Verdict'];
  return (
    <div className="space-y-3">
      <p className="text-[12px]" style={{ color: T.textSecondary }}>
        {b.automatedLikely?.length ? `Flagged as automated: ${b.automatedLikely.join(' · ')}.` : 'No source, country or unusual day looks automated.'} Site average: {b.site?.pageviewsPerVisit} pages per visit, median {b.site?.medianSeconds}s.
      </p>
      <div><Label>By source</Label><SmallTable head={head} rows={(b.bySource || []).map(row)} /></div>
      <div><Label>By visitor country</Label><SmallTable head={head} rows={(b.byCountry || []).map(row)} /></div>
      {(b.anomalyDays || []).length ? <div><Label>Unusual days</Label><SmallTable head={head} rows={b.anomalyDays.map((d) => row({ ...d, key: d.date }))} /></div> : null}
    </div>
  );
}

function Details({ run }) {
  const r = run.result || {};
  const pack = run.pack || {};
  const s = pack.sections || {};
  const b = s.mainSite?.breakdowns || {};
  const dim = (k, label) => (b[k] ? (
    <div key={k}>
      <Label>{label}</Label>
      <SmallTable head={['', 'This period', 'Previous', 'Change']} rows={[...b[k].top.slice(0, 8), ...b[k].otherRisers.slice(0, 3)].map((x) => [x.key, fmtN(x.cur), fmtN(x.prev), pctTxt(x.changePct)])} />
    </div>
  ) : null);
  return (
    <Collapsible title="Details" sub="channels, bot signals, unusual days, the numbers read">
      {(r.channels || []).length ? (
        <div>
          <Label>Channel by channel</Label>
          <div className="divide-y" style={{ borderColor: T.borderLight }}>
            {r.channels.map((c) => {
              const [tone, label] = TREND[c.trend] || TREND.no_data;
              return (
                <div key={c.channel} className="py-2 flex gap-3">
                  <div className="w-40 shrink-0"><p className="text-[12.5px] font-semibold" style={{ color: T.textPrimary }}>{CHANNEL_LABEL[c.channel] || c.channel}</p><Pill tone={tone}>{label}</Pill></div>
                  <p className="text-[12.5px]" style={{ color: T.textBody }}>{c.summary}</p>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
      {s.botSignals ? <div><Label>Bot signals (computed in code)</Label><BotTable b={s.botSignals} /></div> : null}
      <div>
        <Label>Key numbers</Label>
        <SmallTable head={['Number', 'This period', 'Previous', 'Change']} rows={(pack.keyNumbers || []).map((k) => [k.label, fmtN(k.cur, k.unit), fmtN(k.prev, k.unit), pctTxt(k.changePct)])} />
      </div>
      {(s.anomalies?.days || []).map((g) => (
        <div key={g.date}>
          <p className="text-xs font-semibold mb-1" style={{ color: T.textPrimary }}>
            {g.date} — {g.metrics.map((m) => `${m.metric} ${m.value} vs ${m.baselineAvg7} usual (${m.ratio ?? '—'}×)`).join(' · ')}
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {Object.entries(g.whatChanged || {}).map(([k, rows]) => (
              <div key={k}><Label>{k}</Label><SmallTable head={['', 'That day', '7-day avg', 'Extra']} rows={rows.map((x) => [x.key, fmtN(x.value), fmtN(x.avg7), `${x.diff > 0 ? '+' : ''}${x.diff}`])} /></div>
            ))}
          </div>
        </div>
      ))}
      <div className="grid md:grid-cols-2 gap-4">
        {dim('landingPages', 'Landing pages')}
        {dim('languages', 'Browser languages')}
        {dim('devices', 'Devices')}
        {dim('sites', 'Country sites')}
      </div>
      {s.googleAds?.changeHistory?.length ? (
        <div><Label>Google Ads change history</Label><SmallTable head={['Date', 'Campaign', 'What', 'Edits']} rows={s.googleAds.changeHistory.slice(0, 15).map((c) => [c.date, c.campaign, `${c.operation} ${c.resource}`, c.count])} /></div>
      ) : null}
      {pack.outsideWorld?.newsNote ? <p className="text-[12px]" style={{ color: T.textSecondary }}><b>News search note:</b> {pack.outsideWorld.newsNote}{pack.outsideWorld.newsDropped ? ` (${pack.outsideWorld.newsDropped} item(s) dropped: no matching search result)` : ''}</p> : null}
      {(r.dataGaps || []).length ? <p className="text-xs" style={{ color: T.warning }}><b>Data gaps:</b> {r.dataGaps.join(' · ')}</p> : null}
      {Object.entries(s).filter(([, v]) => v?.error).length ? (
        <p className="text-xs" style={{ color: T.danger }}>Unavailable: {Object.entries(s).filter(([, v]) => v?.error).map(([k, v]) => `${k} (${v.error})`).join('; ')}</p>
      ) : null}
    </Collapsible>
  );
}

export function Result({ run }) {
  const r = run.result || {};
  const legacy = !r.changes;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
          {countryName(run.country)} · {run.period ? `${run.period.start} → ${run.period.end} (${run.period.days} days) vs ${run.previousPeriod?.start} → ${run.previousPeriod?.end}` : ''}
        </p>
        <h2 className="text-lg font-bold mt-1" style={{ color: T.textPrimary }}>{r.headline}</h2>
        <p className="text-[13px] leading-relaxed mt-2" style={{ color: T.textBody }}>{r.summary}</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
          {(run.pack?.keyNumbers || []).slice(0, 8).map((k) => (
            <div key={k.label} className="rounded-xl px-3 py-2" style={{ background: T.bgSurface }}>
              <p className="text-[11px]" style={{ color: T.textMuted }}>{k.label}</p>
              <p className="text-base font-bold tabular-nums" style={{ color: T.textPrimary }}>{fmtN(k.cur, k.unit)}</p>
              <p className="text-[11px] tabular-nums" style={{ color: k.changePct > 0 ? T.success : k.changePct < 0 ? T.danger : T.textMuted }}>{pctTxt(k.changePct)} vs {fmtN(k.prev, k.unit)}</p>
            </div>
          ))}
        </div>
      </Card>

      {(r.guardWarnings || []).length ? <Banner tone="warning"><b>Checked in code:</b> {r.guardWarnings.join(' ')}</Banner> : null}
      {legacy ? <Banner tone="warning">This analysis was made by the older version (no evidence checks, no outside-world timeline). Run it again for the new report.</Banner> : null}

      <Card title="What to do next">
        <ol className="space-y-2.5">
          {(r.nextSteps || []).map((n, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-xs font-bold w-5 shrink-0 pt-0.5" style={{ color: T.textMuted }}>{i + 1}</span>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{n.title} <Pill tone={TONE[n.priority] || 'neutral'}>{n.priority}</Pill> <Pill tone="ink">{n.owner}</Pill></p>
                <p className="text-[13px]" style={{ color: T.textBody }}>{n.why}{n.impact ? <span style={{ color: T.success }}> → {n.impact}</span> : null}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <AnalystCharts pack={run.pack} />

      {(r.changes || []).length ? <Changes items={r.changes} /> : null}
      {run.pack?.outsideWorld ? <OutsideWorld pack={run.pack} verdicts={r.outsideWorld} /> : null}

      <Details run={run} />
      <p className="text-[11px]" style={{ color: T.textMuted }}>
        {run.model} · US${Number(run.costUsd || 0).toFixed(2)}{run.usage?.webSearches ? ` · ${run.usage.webSearches} web search(es)` : ''} · {fmtDate(run.finishedAt, true)}{run.by ? ` · ${run.by}` : ''}
      </p>
    </div>
  );
}

export default function AnalystTab() {
  const [meta, setMeta] = useState(null);
  const [country, setCountry] = useState('');
  const [days, setDays] = useState(28);
  const [custom, setCustom] = useState(false);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const timer = useRef(null);

  const loadList = useCallback(() => fetch('/api/manager/analyst').then((r) => r.json()).then((j) => {
    if (j.error) { setErr(j.error); return; }
    setMeta(j);
    setCountry((c) => c || j.country || 'py');
  }).catch(() => setErr('Could not load')), []);
  useEffect(() => { loadList(); }, [loadList]);

  const open = useCallback(async (id) => {
    const j = await fetch(`/api/manager/analyst/${id}`).then((r) => r.json()).catch(() => ({ error: 'failed' }));
    if (j.error) { setErr(j.error); return null; }
    setRun(j.run);
    return j.run;
  }, []);

  // poll the running analysis
  useEffect(() => {
    if (!busyId) return undefined;
    const t0 = Date.now();
    timer.current = setInterval(async () => {
      setElapsed(Math.round((Date.now() - t0) / 1000));
      const r = await open(busyId);
      if (r && r.status !== 'running') { setBusyId(null); loadList(); if (r.status === 'failed') setErr(r.error || 'The analysis failed'); }
    }, 3000);
    return () => clearInterval(timer.current);
  }, [busyId, open, loadList]);

  const start_ = async () => {
    setErr(''); setRun(null); setElapsed(0);
    const body = custom ? { country, start, end } : { country, days };
    const j = await fetch('/api/manager/analyst', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: 'failed' }));
    if (j.error) { setErr(j.error); return; }
    setBusyId(j.id);
  };

  const running = !!busyId;
  const choices = meta?.allCountries ? [['all', 'All countries'], ...COUNTRIES] : COUNTRIES;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[13px] mb-3" style={{ color: T.textSecondary }}>
          Reads every source together — website (PostHog), funnel sites and hub, Search Console, Google Ads with its change history, our WhatsApp/email sends, funnel leads — finds the unusual days and bot signals in code, lines them up with outside events (exchange rates, holidays, disasters, weather, news) and asks Claude <b>why</b> the numbers moved — every claim with its numbers and a confidence level.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs" style={{ color: T.textMuted }}>
            Country
            <select value={country} onChange={(e) => setCountry(e.target.value)} disabled={running} className="block mt-1 px-3 py-2 rounded-lg border text-[13px] bg-white" style={{ borderColor: T.borderLight, color: T.textPrimary }}>
              {choices.map(([c, n]) => <option key={c} value={c}>{n}</option>)}
            </select>
          </label>
          <div className="text-xs" style={{ color: T.textMuted }}>
            Period
            <div className="flex gap-1.5 mt-1">
              {[7, 28, 90].map((d) => (
                <button key={d} type="button" disabled={running} onClick={() => { setDays(d); setCustom(false); }} className={btnSecondary}
                  style={!custom && days === d ? { background: T.primary, color: '#fff', borderColor: T.primary } : { borderColor: T.borderLight, color: T.textBody }}>{d} days</button>
              ))}
              <button type="button" disabled={running} onClick={() => setCustom(true)} className={btnSecondary}
                style={custom ? { background: T.primary, color: '#fff', borderColor: T.primary } : { borderColor: T.borderLight, color: T.textBody }}>Custom</button>
            </div>
          </div>
          {custom ? (
            <div className="flex gap-2 text-xs" style={{ color: T.textMuted }}>
              <label>From<input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg border text-[13px]" style={{ borderColor: T.borderLight }} /></label>
              <label>To<input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="block mt-1 px-2 py-1.5 rounded-lg border text-[13px]" style={{ borderColor: T.borderLight }} /></label>
            </div>
          ) : null}
          <button type="button" className={btnPrimary} onClick={start_} disabled={running || !country || meta?.configured === false || (custom && !(start && end))}>
            {running ? 'Analysing…' : 'Run analysis'}
          </button>
        </div>
        {running ? (
          <div className="mt-4 flex items-center gap-3 text-xs" style={{ color: T.info }}>
            <span className="inline-block w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin" />
            {STAGE[run?.stage] || STAGE.collect} <span style={{ color: T.textMuted }}>{elapsed}s · usually 1–3 minutes</span>
          </div>
        ) : null}
      </Card>

      {meta?.configured === false ? <Banner tone="warning">Set <span className="font-mono">ANTHROPIC_API_KEY</span> on the server to use the AI Analyst.</Banner> : null}
      {err ? <Banner>{err}</Banner> : null}

      {run?.status === 'done' ? <Result run={run} /> : null}

      {(meta?.runs || []).length ? (
        <Card title="Earlier analyses" right={<span className="text-[11px]" style={{ color: T.textMuted }}>saved in the database</span>}>
          <SmallTable
            head={['Analysis', 'Country', 'Period', 'Cost']}
            rows={meta.runs.slice(0, 15).map((r) => [
              <button key={r.id} type="button" className="text-left underline-offset-2 hover:underline" style={{ color: r.status === 'failed' ? T.danger : T.textPrimary }} onClick={() => open(r.id)}>
                {r.headline || (r.status === 'running' ? 'Running…' : r.error ? `Failed: ${r.error.slice(0, 80)}` : '—')}
                <span className="block text-[11px]" style={{ color: T.textMuted }}>{fmtDate(r.createdAt, true)}</span>
              </button>,
              countryName(r.country),
              r.period ? `${r.period.start} → ${r.period.end}` : '—',
              r.costUsd != null ? `US$${Number(r.costUsd).toFixed(2)}` : '—',
            ])}
          />
        </Card>
      ) : null}
    </div>
  );
}
