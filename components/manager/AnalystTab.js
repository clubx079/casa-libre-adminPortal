'use client';
// Admin Manager → "AI Analyst": pick a country (or all) and a period, run the analysis, read why
// the numbers moved. Data: /api/manager/analyst (lib/analyst/*). Runs are kept by the server
// (memory + local file), not in the database.
import { useCallback, useEffect, useRef, useState } from 'react';
import { T, CARD, Pill, Banner, fmtDate, btnPrimary, btnSecondary } from '@/components/automations/ui';

const COUNTRIES = [['py', 'Paraguay'], ['bo', 'Bolivia'], ['uy', 'Uruguay'], ['ve', 'Venezuela'], ['sv', 'El Salvador']];
const CHANNEL_LABEL = {
  organic_google: 'Organic Google', google_ads: 'Google Ads', ai_search: 'ChatGPT / AI search', whatsapp: 'WhatsApp',
  email: 'Email', funnels: 'Funnel sites', hub: 'casa-libre.com hub', direct_other: 'Direct & other',
};
const STAGE = { collect: 'Collecting the numbers (PostHog, Search Console, Google Ads, sends)…', search: 'Looking up outside events on the anomaly days…', analyze: 'Claude is reading everything…' };
const TONE = { high: 'danger', medium: 'warning', low: 'neutral' };
const TREND = { up: ['success', 'Up'], down: ['danger', 'Down'], flat: ['neutral', 'Flat'], new: ['info', 'New'], no_data: ['neutral', 'No data'] };
const countryName = (cc) => (cc === 'all' ? 'All countries' : (COUNTRIES.find(([c]) => c === cc) || [cc, cc.toUpperCase()])[1]);
const fmtN = (v, unit = '') => (v == null ? '—' : `${unit === 'US$' ? 'US$' : ''}${Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 })}`);
const pctTxt = (p) => (p == null ? 'new' : `${p > 0 ? '+' : ''}${p}%`);

function Card({ title, children, right }) {
  return (
    <div className="bg-white p-5" style={CARD}>
      {title ? (
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold" style={{ color: T.textPrimary }}>{title}</h3>
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
        <thead><tr style={{ color: T.textMuted }}>{head.map((h, i) => <th key={h} className={`py-1.5 pr-3 font-semibold ${i ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
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

function DataUsed({ run }) {
  const [open, setOpen] = useState(false);
  const pack = run.pack || {};
  const s = pack.sections || {};
  const b = s.mainSite?.breakdowns || {};
  const dim = (k, label) => (b[k] ? (
    <div key={k}>
      <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.textMuted }}>{label}</p>
      <SmallTable head={['', 'This period', 'Previous', 'Change']} rows={[...b[k].top.slice(0, 8), ...b[k].otherRisers.slice(0, 3)].map((r) => [r.key, fmtN(r.cur), fmtN(r.prev), pctTxt(r.changePct)])} />
    </div>
  ) : null);
  return (
    <div className="bg-white" style={CARD}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-5 py-3.5 text-left">
        <span className="text-sm font-semibold" style={{ color: T.textPrimary }}>Data used</span>
        <span className="text-xs" style={{ color: T.textMuted }}>{open ? 'Hide' : 'Show'} the numbers the analysis read</span>
      </button>
      {open ? (
        <div className="px-5 pb-5 space-y-5 border-t pt-4" style={{ borderColor: T.borderLight }}>
          <SmallTable head={['Number', 'This period', 'Previous', 'Change']} rows={(pack.keyNumbers || []).map((k) => [k.label, fmtN(k.cur, k.unit), fmtN(k.prev, k.unit), pctTxt(k.changePct)])} />
          {(s.anomalies?.days || []).map((g) => (
            <div key={g.date}>
              <p className="text-xs font-semibold mb-1" style={{ color: T.textPrimary }}>
                {g.date} — {g.metrics.map((m) => `${m.metric} ${m.value} vs ${m.baselineAvg7} usual (${m.ratio ?? '—'}×)`).join(' · ')}
              </p>
              <div className="grid md:grid-cols-2 gap-4">
                {Object.entries(g.whatChanged || {}).map(([k, rows]) => (
                  <div key={k}>
                    <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.textMuted }}>{k}</p>
                    <SmallTable head={['', 'That day', '7-day avg', 'Extra']} rows={rows.map((r) => [r.key, fmtN(r.value), fmtN(r.avg7), `${r.diff > 0 ? '+' : ''}${r.diff}`])} />
                  </div>
                ))}
              </div>
            </div>
          ))}
          <div className="grid md:grid-cols-2 gap-4">
            {dim('sources', 'Sources (visitor-days)')}
            {dim('countries', 'Visitor countries')}
            {dim('landingPages', 'Landing pages')}
            {dim('languages', 'Browser languages')}
            {dim('devices', 'Devices')}
            {dim('sites', 'Country sites')}
          </div>
          {s.googleAds?.changeHistory?.length ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.textMuted }}>Google Ads change history</p>
              <SmallTable head={['Date', 'Campaign', 'What', 'Edits']} rows={s.googleAds.changeHistory.slice(0, 15).map((c) => [c.date, c.campaign, `${c.operation} ${c.resource}`, c.count])} />
            </div>
          ) : null}
          {pack.externalEvents?.events?.length ? (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-wide mb-1" style={{ color: T.textMuted }}>Web search: outside events</p>
              <ul className="text-xs space-y-1" style={{ color: T.textBody }}>
                {pack.externalEvents.events.map((e, i) => <li key={i}><b>{e.date}</b> {e.event}{e.url ? <> — <a href={e.url} target="_blank" rel="noreferrer" className="underline">source</a></> : null}</li>)}
              </ul>
            </div>
          ) : null}
          {Object.entries(s).filter(([, v]) => v?.error).length ? (
            <p className="text-xs" style={{ color: T.danger }}>Unavailable: {Object.entries(s).filter(([, v]) => v?.error).map(([k, v]) => `${k} (${v.error})`).join('; ')}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Result({ run }) {
  const r = run.result || {};
  const text = (v) => <p className="text-[13px] leading-relaxed" style={{ color: T.textBody }}>{v}</p>;
  return (
    <div className="space-y-4">
      <Card>
        <p className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>
          {countryName(run.country)} · {run.period ? `${run.period.start} → ${run.period.end} (${run.period.days} days) vs ${run.previousPeriod?.start} → ${run.previousPeriod?.end}` : ''}
        </p>
        <h2 className="text-lg font-bold mt-1" style={{ color: T.textPrimary }}>{r.headline}</h2>
        <div className="mt-2">{text(r.summary)}</div>
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

      {(r.anomalies || []).length ? (
        <Card title="Anomalies — what happened and why">
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[680px]">
              <thead><tr style={{ color: T.textMuted }}>{['Day', 'What', 'Likely cause', 'Evidence', 'Confidence'].map((h) => <th key={h} className="text-left py-1.5 pr-3 font-semibold">{h}</th>)}</tr></thead>
              <tbody>
                {r.anomalies.map((a, i) => (
                  <tr key={i} className="border-t align-top" style={{ borderColor: T.borderLight }}>
                    <td className="py-2 pr-3 whitespace-nowrap font-semibold" style={{ color: T.textPrimary }}>{a.date}<br /><Pill tone={a.kind === 'spike' ? 'info' : 'warning'}>{a.kind}</Pill></td>
                    <td className="py-2 pr-3" style={{ color: T.textBody }}>{a.what}</td>
                    <td className="py-2 pr-3" style={{ color: T.textBody }}>{a.cause}{a.ruledOut ? <p className="mt-1" style={{ color: T.textMuted }}>Ruled out: {a.ruledOut}</p> : null}</td>
                    <td className="py-2 pr-3" style={{ color: T.textBody }}><ul className="list-disc pl-4 space-y-0.5">{(a.evidence || []).map((e, j) => <li key={j}>{e}</li>)}</ul></td>
                    <td className="py-2 pr-3"><Pill tone={a.confidence === 'high' ? 'success' : a.confidence === 'medium' ? 'warning' : 'neutral'}>{a.confidence}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="What's working">
          <ul className="space-y-2">{(r.working || []).map((w, i) => <li key={i} className="text-[13px]" style={{ color: T.textBody }}><b style={{ color: T.success }}>{w.title}.</b> {w.detail}</li>)}</ul>
        </Card>
        <Card title="What's not">
          <ul className="space-y-2">{(r.notWorking || []).map((w, i) => <li key={i} className="text-[13px]" style={{ color: T.textBody }}><b style={{ color: T.danger }}>{w.title}.</b> {w.detail}</li>)}</ul>
        </Card>
      </div>

      <Card title="Channel by channel">
        <div className="divide-y" style={{ borderColor: T.borderLight }}>
          {(r.channels || []).map((c) => {
            const [tone, label] = TREND[c.trend] || TREND.no_data;
            return (
              <div key={c.channel} className="py-2.5 flex gap-3">
                <div className="w-40 shrink-0">
                  <p className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{CHANNEL_LABEL[c.channel] || c.channel}</p>
                  <Pill tone={tone}>{label}</Pill>
                </div>
                <p className="text-[13px]" style={{ color: T.textBody }}>{c.summary}</p>
              </div>
            );
          })}
        </div>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card title="Countries & audience">
          <ul className="space-y-2">{(r.audience || []).map((w, i) => <li key={i} className="text-[13px]" style={{ color: T.textBody }}><b>{w.title}.</b> {w.detail}</li>)}</ul>
        </Card>
        <Card title="Outside events">
          {(r.externalContext || []).length ? (
            <ul className="space-y-2">
              {r.externalContext.map((e, i) => (
                <li key={i} className="text-[13px]" style={{ color: T.textBody }}>
                  <b>{e.date}</b> — {e.event} <span style={{ color: T.textMuted }}>({e.relevance})</span>{' '}
                  {e.source === 'model_knowledge' ? <Pill tone="warning">model knowledge, not verified</Pill> : <Pill tone="info">web search</Pill>}
                </li>
              ))}
            </ul>
          ) : <p className="text-xs" style={{ color: T.textMuted }}>None found for this period.</p>}
        </Card>
      </div>

      <Card title="Next steps">
        <ol className="space-y-2.5">
          {(r.nextSteps || []).map((n, i) => (
            <li key={i} className="flex gap-3">
              <span className="text-xs font-bold w-5 shrink-0 pt-0.5" style={{ color: T.textMuted }}>{i + 1}</span>
              <div>
                <p className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{n.title} <Pill tone={TONE[n.priority] || 'neutral'}>{n.priority}</Pill> <Pill tone="ink">{n.owner}</Pill></p>
                <p className="text-[13px]" style={{ color: T.textBody }}>{n.why}</p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {(r.dataGaps || []).length ? <Banner tone="warning"><b>Data gaps:</b> {r.dataGaps.join(' · ')}</Banner> : null}
      <DataUsed run={run} />
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
          Reads every source together — website (PostHog), funnel sites and hub, Search Console, Google Ads with its change history, our WhatsApp/email sends, funnel leads — finds the unusual days in code, and asks Claude <b>why</b> the numbers moved.
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
        <Card title="Earlier analyses" right={<span className="text-[11px]" style={{ color: T.textMuted }}>kept on this server, not in the database</span>}>
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
