'use client';
// Admin Manager → AI SEO: one report per SEO pipeline run (daily 06:00 Paraguay, or "Run now").
// Each run: status, the AI report, what it changed and why (pages added, edited, guides), keywords and
// rankings, the results of every page the pipeline touched, and the comparison with the previous run.
// Data: /api/manager/seo (lib/seo/runLog.js, table seo_runs — migrations/012_seo_runs.sql).
// Optional `site` prop (a key of lib/funnelSites.js): the same views for one of the six SEO sites (Admin → Funnels
// → AI SEO); every request then carries site=<key>. Sites only get guides, titles and internal links.
import { useCallback, useEffect, useState } from 'react';
import { T, CARD, Pill, Banner, fmtDate, btnPrimary, btnSecondary } from '@/components/automations/ui';
import SeoPipeline from '@/components/seo/SeoPipeline';
import { funnelSiteDomain } from '@/lib/funnelSites';

/** Appends site=<key> to an API URL when a site is given (else the URL is unchanged). */
const withSite = (url, siteKey) => (siteKey ? `${url}${url.includes('?') ? '&' : '?'}site=${encodeURIComponent(siteKey)}` : url);

const STATUS = { improving: ['success', 'Improving'], steady: ['info', 'Steady'], declining: ['danger', 'Declining'], starting: ['neutral', 'Starting'] };
const RUN = { running: ['info', 'Running…'], done: ['success', 'Done'], failed: ['danger', 'Failed'] };
const ACTION = {
  enable_variant: 'Page added', publish_guide: 'Guide published', set_title: 'Title changed', add_links: 'Links added',
  retire_variant: 'Page hidden', unpublish_guide: 'Guide unpublished',
};
const num = (v) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toLocaleString('en-US'));
const pos = (v) => (v ? Number(v).toFixed(1) : '—');
const signed = (v, suffix = '') => (v == null ? '—' : `${v > 0 ? '+' : ''}${v}${suffix}`);
const deltaColor = (v, invert = false) => (v == null || v === 0 ? T.textMuted : (invert ? v < 0 : v > 0) ? T.success : T.danger);
const count = (changes, a) => (changes || []).filter((c) => c.action === a).length;

function Th({ children, right }) { return <th className={`px-3 py-2 font-semibold ${right ? 'text-right' : 'text-left'}`} style={{ color: T.textMuted }}>{children}</th>; }
function Td({ children, right, mono }) { return <td className={`px-3 py-2 align-top ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-[11px]' : ''}`} style={{ color: T.textBody }}>{children}</td>; }
function Section({ title, sub, children }) {
  return (
    <section className="p-5" style={CARD}>
      <h3 className="text-[15px] font-bold" style={{ color: T.textPrimary }}>{title}</h3>
      {sub ? <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}>{sub}</p> : null}
      <div className="mt-3">{children}</div>
    </section>
  );
}
function List({ items, empty }) {
  if (!items?.length) return <p className="text-[13px]" style={{ color: T.textMuted }}>{empty}</p>;
  return <ul className="space-y-1.5 text-[13px] leading-relaxed" style={{ color: T.textBody }}>{items.map((x, i) => <li key={i} className="pl-3 border-l-2" style={{ borderColor: T.borderLight }}>{x}</li>)}</ul>;
}
function Tile({ label, value, delta, deltaText, invert }) {
  return (
    <div className="p-4" style={CARD}>
      <div className="text-[12px]" style={{ color: T.textSecondary }}>{label}</div>
      <div className="text-[22px] font-bold tabular-nums mt-0.5" style={{ color: T.textPrimary }}>{value}</div>
      <div className="text-[12px] mt-0.5 tabular-nums" style={{ color: deltaColor(delta, invert) }}>{deltaText}</div>
    </div>
  );
}

function RunDetail({ id, onBack, siteKey }) {
  const [run, setRun] = useState(null);
  const [err, setErr] = useState('');
  const domain = siteKey ? funnelSiteDomain(siteKey) || siteKey : 'casa-libre';
  useEffect(() => {
    let alive = true;
    fetch(withSite(`/api/manager/seo?id=${id}`, siteKey)).then((r) => r.json()).then((j) => { if (!alive) return; if (j.error) setErr(j.error); else setRun(j.run); }).catch(() => alive && setErr('failed'));
    return () => { alive = false; };
  }, [id, siteKey]);
  if (err) return <Banner>Could not load the run: {err}</Banner>;
  if (!run) return <p className="text-[13px]" style={{ color: T.textMuted }}>Loading…</p>;
  const r = run.report || {};
  const snap = run.snapshot || {};
  const cmp = run.comparison || {};
  const w = cmp.weekOnWeek?.site || {};
  const wp = cmp.weekOnWeek?.pipeline || {};
  const vs = cmp.vsPreviousRun;
  const site = snap.site?.cur || {};
  const [tone, label] = STATUS[r.status] || STATUS.starting;
  const changes = run.changes || [];
  const groups = Object.keys(ACTION).map((a) => [a, changes.filter((c) => c.action === a)]).filter(([, l]) => l.length);
  const kwMove = new Map((cmp.keywordMoves || []).map((k) => [k.query, k.gain]));
  return (
    <div className="space-y-4">
      <button type="button" onClick={onBack} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }}>← All runs</button>

      <section className="p-5" style={CARD}>
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone}>{label}</Pill>
          <span className="text-[12px]" style={{ color: T.textSecondary }}>{fmtDate(run.started_at, true)} · {run.trigger === 'cron' ? 'daily run' : 'run by hand'}{snap.window ? ` · Google data ${snap.window.start} – ${snap.window.end}` : ''}</span>
        </div>
        <h2 className="text-[18px] font-bold mt-3 leading-snug" style={{ color: T.textPrimary }}>{r.headline || (run.status === 'running' ? 'This run is still working…' : 'No report')}</h2>
        <div className="mt-2 space-y-2 text-[13px] leading-relaxed" style={{ color: T.textBody }}>{(r.summary || []).map((p, i) => <p key={i}>{p}</p>)}</div>
        {r.writtenBy === 'numbers'
          ? <div className="mt-3"><Banner tone="warning"><b>Not written by Claude this run.</b> {r.aiNote || 'Claude did not answer.'} — the report below is written from the numbers only; the data is complete.</Banner></div>
          : <p className="text-[11px] mt-3" style={{ color: T.textMuted }}>Written by Claude ({r.writtenBy || run.model || '—'})</p>}
        {run.error ? <div className="mt-3"><Banner>{run.error}</Banner></div> : null}
      </section>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="Google clicks (7 days)" value={num(site.clicks)} delta={w.clicks} deltaText={`${signed(w.clicksPct, '%')} vs week before`} />
        <Tile label="Google views (7 days)" value={num(site.impressions)} delta={w.impressions} deltaText={`${signed(w.impressionsPct, '%')} vs week before`} />
        <Tile label="Average position" value={pos(site.position)} delta={w.positionGain} deltaText={w.positionGain == null ? '—' : w.positionGain >= 0 ? `up ${w.positionGain}` : `down ${-w.positionGain}`} />
        <Tile label="Clicks on pipeline pages" value={num(snap.pipeline?.cur?.clicks)} delta={wp.clicks} deltaText={`${signed(wp.clicksPct, '%')} vs week before`} />
      </div>

      <Section title="What this run changed" sub={siteKey
        ? `${count(changes, 'publish_guide')} guides · ${count(changes, 'set_title')} titles · ${count(changes, 'add_links')} link edits`
        : `${count(changes, 'enable_variant')} pages added · ${count(changes, 'publish_guide')} guides · ${count(changes, 'set_title') + count(changes, 'add_links')} edits · ${count(changes, 'retire_variant')} hidden`}>
        {!groups.length ? <p className="text-[13px]" style={{ color: T.textMuted }}>No page changes in this run.</p> : (
          <div className="space-y-4">
            {groups.map(([a, list]) => (
              <div key={a}>
                <div className="text-[12px] font-semibold mb-1.5" style={{ color: T.textSecondary }}>{ACTION[a]} ({list.length})</div>
                <div className="overflow-x-auto"><table className="w-full text-[12px] min-w-[560px]"><tbody>
                  {list.map((c, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: T.borderLight }}>
                      <Td mono>{c.path}</Td><Td>{c.reason || '—'}</Td>
                    </tr>
                  ))}
                </tbody></table></div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Wins"><List items={r.wins} empty="Nothing stood out this run." /></Section>
        <Section title="Problems"><List items={r.problems} empty="No problems found." /></Section>
      </div>

      <Section title="Keywords and rankings" sub={`Top 25 Google searches that showed ${domain} (last 7 days), with the change in position vs the week before. Lower position = higher on Google.`}>
        {r.keywords?.length ? <div className="mb-3"><List items={r.keywords} /></div> : null}
        {!(snap.keywords || []).length ? <p className="text-[13px]" style={{ color: T.textMuted }}>No Search Console data this run.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-[12px] min-w-[560px]">
            <thead><tr><Th>Search</Th><Th right>Position</Th><Th right>Change</Th><Th right>Clicks</Th><Th right>Views</Th></tr></thead>
            <tbody>{snap.keywords.map((k) => {
              const g = kwMove.get(k.query) ?? (k.prevPosition ? Math.round((k.prevPosition - k.position) * 10) / 10 : null);
              return (
                <tr key={k.query} className="border-t" style={{ borderColor: T.borderLight }}>
                  <Td>{k.query}</Td><Td right>{pos(k.position)}</Td>
                  <td className="px-3 py-2 text-right tabular-nums" style={{ color: deltaColor(g) }}>{g == null ? 'new' : g === 0 ? '—' : g > 0 ? `▲ ${g}` : `▼ ${-g}`}</td>
                  <Td right>{num(k.clicks)}</Td><Td right>{num(k.impressions)}</Td>
                </tr>
              );
            })}</tbody>
          </table></div>
        )}
      </Section>

      <Section title="Results of the pipeline's pages" sub={siteKey
        ? `Live now: ${num(snap.pages?.guides)} guides · ${num(snap.pages?.titles)} new titles · ${num(snap.pages?.linked)} pages with extra links. Google = last 7 days vs the week before; visits from PostHog (7 days).`
        : `Live now:${num(snap.pages?.variants)} added pages · ${num(snap.pages?.guides)} guides · ${num(snap.pages?.titles)} new titles · ${num(snap.pages?.linked)} pages with extra links · ${num(snap.pages?.retired)} hidden. Google = last 7 days vs the week before; visits and contacts from PostHog (7 days).`}>
        {!(snap.pageResults || []).length ? <p className="text-[13px]" style={{ color: T.textMuted }}>No pipeline pages yet.</p> : (
          <div className="overflow-x-auto"><table className="w-full text-[12px] min-w-[720px]">
            <thead><tr><Th>Page</Th><Th>Type</Th><Th right>Google clicks</Th><Th right>Views</Th><Th right>Position</Th><Th right>Visits</Th><Th right>Contacts</Th></tr></thead>
            <tbody>{snap.pageResults.slice(0, 100).map((p) => (
              <tr key={p.path} className="border-t" style={{ borderColor: T.borderLight }}>
                <Td mono>{p.path}</Td><Td>{p.kind}</Td>
                <Td right>{num(p.clicks)} <span style={{ color: T.textMuted }}>({num(p.prevClicks)})</span></Td>
                <Td right>{num(p.impressions)} <span style={{ color: T.textMuted }}>({num(p.prevImpressions)})</span></Td>
                <Td right>{pos(p.position)}</Td><Td right>{num(p.visits)}</Td><Td right>{num(p.contacts)}</Td>
              </tr>
            ))}</tbody>
          </table><p className="text-[11px] mt-2" style={{ color: T.textMuted }}>(in brackets: the week before)</p></div>
        )}
      </Section>

      <Section title="Compared with the previous run">
        {!vs ? <p className="text-[13px]" style={{ color: T.textMuted }}>This is the first recorded run — the next run will be compared with this one.</p> : (
          <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1.5 text-[13px]" style={{ color: T.textBody }}>
            <div>Google clicks (site): <b style={{ color: deltaColor(vs.site?.clicks) }}>{signed(vs.site?.clicks)}</b> ({signed(vs.site?.clicksPct, '%')})</div>
            <div>Google views (site): <b style={{ color: deltaColor(vs.site?.impressions) }}>{signed(vs.site?.impressions)}</b> ({signed(vs.site?.impressionsPct, '%')})</div>
            <div>Average position: <b style={{ color: deltaColor(vs.site?.positionGain) }}>{vs.site?.positionGain == null ? '—' : vs.site.positionGain >= 0 ? `up ${vs.site.positionGain}` : `down ${-vs.site.positionGain}`}</b></div>
            <div>Clicks on pipeline pages: <b style={{ color: deltaColor(vs.pipeline?.clicks) }}>{signed(vs.pipeline?.clicks)}</b></div>
            {siteKey ? <>
              <div>Guides live: <b>{signed(vs.pages?.guides)}</b></div>
              <div>New titles: <b>{signed(vs.pages?.titles)}</b> · pages with extra links: <b>{signed(vs.pages?.linked)}</b></div>
            </> : <>
              <div>Added pages live: <b>{signed(vs.pages?.variants)}</b> · guides: <b>{signed(vs.pages?.guides)}</b></div>
              <div>New titles: <b>{signed(vs.pages?.titles)}</b> · pages hidden: <b>{signed(vs.pages?.retired)}</b></div>
            </>}
            {vs.newKeywords?.length ? <div className="sm:col-span-2">New in the top 25 searches: {vs.newKeywords.join(', ')}</div> : null}
          </div>
        )}
      </Section>

      <div className="grid lg:grid-cols-2 gap-4">
        <Section title="Next"><List items={r.next} empty="—" /></Section>
        <Section title="Paid searches (Google Ads, 30 days)" sub={`What people clicked in our ads — the pipeline builds ${siteKey ? 'guides' : 'pages'} for proven searches.`}>
          {!(snap.adsTerms || []).length ? <p className="text-[13px]" style={{ color: T.textMuted }}>No Ads data.</p> : (
            <table className="w-full text-[12px]"><tbody>{snap.adsTerms.slice(0, 10).map((a) => (
              <tr key={a.term} className="border-t" style={{ borderColor: T.borderLight }}><Td>{a.term}</Td><Td right>{num(a.clicks)} clicks</Td><Td right>{num(a.conversions)} conv.</Td></tr>
            ))}</tbody></table>
          )}
        </Section>
      </div>

      {snap.notes?.length ? <Banner tone="warning">Data gaps this run: {snap.notes.join(' · ')}</Banner> : null}
    </div>
  );
}

const VIEWS = [['reports', 'Run reports'], ['pipeline', 'Pipeline: opportunities, guides, changes, signals, settings']];

export default function SeoTab({ site = null }) {
  const [view, setView] = useState('reports');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {VIEWS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setView(k)} className="text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full border transition-colors"
            style={view === k ? { background: T.primary, color: '#fff', borderColor: T.primary } : { borderColor: T.borderLight, color: T.textBody }}>{label}</button>
        ))}
      </div>
      {view === 'pipeline' ? <SeoPipeline site={site} /> : <SeoRuns siteKey={site} />}
    </div>
  );
}

function SeoRuns({ siteKey }) {
  const [data, setData] = useState(null);
  const domain = siteKey ? funnelSiteDomain(siteKey) || siteKey : '';
  const [err, setErr] = useState('');
  const [open, setOpen] = useState(null);
  const [starting, setStarting] = useState(false);
  const load = useCallback(() => {
    fetch(withSite('/api/manager/seo', siteKey)).then((r) => r.json()).then((j) => { if (j.error) setErr(j.error); else { setErr(''); setData(j); } }).catch(() => setErr('failed'));
  }, [siteKey]);
  useEffect(() => { load(); }, [load]);
  const runs = data?.runs || [];
  const busy = runs.some((r) => r.status === 'running');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  const runNow = async () => {
    setStarting(true);
    try {
      const j = await fetch(withSite('/api/manager/seo', siteKey), { method: 'POST' }).then((r) => r.json());
      if (j.error) setErr(j.error); else setTimeout(load, 1500);
    } catch { setErr('failed'); }
    setStarting(false);
  };

  if (open) return <RunDetail id={open} siteKey={siteKey} onBack={() => { setOpen(null); load(); }} />;
  return (
    <div className="space-y-4">
      <section className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={CARD}>
        <div>
          <h2 className="text-[15px] font-bold" style={{ color: T.textPrimary }}>{siteKey ? `AI SEO · ${domain}` : 'AI SEO'}</h2>
          <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}>{siteKey
            ? 'The SEO pipeline runs for this site every day: it writes and publishes new guides, improves titles and adds internal links by itself, then writes this report — what it changed and why, keywords and rankings, results, and the comparison with the previous run.'
            : 'The automatic SEO pipeline runs every day at 06:00 (Paraguay): it adds and edits pages by itself, then writes this report — what it changed and why, keywords and rankings, results, and the comparison with the previous run.'}</p>
        </div>
        <button type="button" className={btnPrimary} disabled={busy || starting || data?.pending} onClick={runNow}>{busy ? 'Running…' : starting ? 'Starting…' : 'Run now'}</button>
      </section>
      {data?.pending ? (siteKey
        ? <Banner tone="warning"><b>Not set up for the sites yet.</b> Apply <span className="font-mono">migrations/012_seo_runs.sql</span> (admin repo) to the Paraguay database in the AiroBase SQL editor, then reload.</Banner>
        : <Banner tone="warning"><b>Not set up for this country yet.</b> Apply <span className="font-mono">migrations/012_seo_runs.sql</span> (admin repo) to this country&apos;s database in the AiroBase SQL editor, then reload.</Banner>) : null}
      {err ? <Banner>{err}</Banner> : null}
      {!data && !err ? <p className="text-[13px]" style={{ color: T.textMuted }}>Loading…</p> : null}
      {data && !data.pending && !runs.length ? <p className="text-[13px]" style={{ color: T.textMuted }}>{siteKey ? 'No runs yet for this site. The first one happens with the next daily run, or press Run now.' : 'No runs yet. The first one happens at the next 06:00 (Paraguay), or press Run now.'}</p> : null}
      {runs.length ? (
        <div className="overflow-x-auto" style={CARD}>
          <table className="w-full text-xs min-w-[820px]">
            <thead><tr className="border-b" style={{ borderColor: T.borderLight }}>
              <Th>Run</Th><Th>SEO status</Th><Th>Report</Th>{siteKey ? null : <Th right>Pages added</Th>}<Th right>Guides</Th><Th right>{siteKey ? 'Titles + links' : 'Edits'}</Th><Th right>Google clicks w/w</Th><Th right>Position</Th>
            </tr></thead>
            <tbody>{runs.map((r) => {
              const [rt, rl] = RUN[r.status] || RUN.done;
              const [st, sl] = STATUS[r.report_status] || [null, null];
              const site = r.site || {};
              return (
                <tr key={r.id} className="border-t cursor-pointer hover:bg-black/[0.02]" style={{ borderColor: T.borderLight }} onClick={() => r.status !== 'running' && setOpen(r.id)}>
                  <td className="px-3 py-2.5 whitespace-nowrap" style={{ color: T.textBody }}>{fmtDate(r.started_at, true)}<div className="text-[11px]" style={{ color: T.textMuted }}>{r.trigger === 'cron' ? 'daily' : 'by hand'}</div></td>
                  <td className="px-3 py-2.5">{r.status === 'done' && st ? <Pill tone={st}>{sl}</Pill> : <Pill tone={rt}>{rl}</Pill>}</td>
                  <td className="px-3 py-2.5 max-w-[360px]" style={{ color: T.textBody }}>{r.headline || r.error || '—'}</td>
                  {siteKey ? null : <Td right>{count(r.changes, 'enable_variant')}</Td>}
                  <Td right>{count(r.changes, 'publish_guide')}</Td>
                  <Td right>{count(r.changes, 'set_title') + count(r.changes, 'add_links')}</Td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: deltaColor(site.clicksPct) }}>{site.clicksPct == null ? '—' : signed(site.clicksPct, '%')}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums" style={{ color: deltaColor(site.positionGain) }}>{site.positionGain == null ? '—' : site.positionGain >= 0 ? `▲ ${site.positionGain}` : `▼ ${-site.positionGain}`}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
