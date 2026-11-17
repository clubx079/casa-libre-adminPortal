'use client';
// SEO — the automatic SEO pipeline for the active country (design: Casa-Libre-SEO-Pipeline.pdf):
// Collect → Understand → Decide → Create → Check → Publish → Watch → Improve.
//   Opportunities  ranked actions (Apply / Dismiss)
//   Drafts         guide drafts waiting for a person (approve / edit / reject / regenerate with Claude)
//   Changes        every change, with one-click revert
//   Signals        latest Google Ads terms, Search Console queries, site searches, Google Trends
//   Watch          performance per page (Search Console + Ads + PostHog contacts)
//   Settings       feature switches + thresholds
// Data: /api/seo, actions: /api/seo/action (lib/seo/*).
import { useCallback, useEffect, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, btnPrimary, btnSecondary, fmtDate, inputCls } from '@/components/automations/ui';

const TABS = [['opportunities', 'Opportunities'], ['drafts', 'Drafts'], ['changes', 'Changes'], ['signals', 'Signals'], ['watch', 'Watch'], ['settings', 'Settings']];
const TYPE = {
  create_variant: ['Create page variant', 'success'], strengthen_page: ['Strengthen page', 'info'], write_guide: ['Write guide', 'warning'],
  trend_post: ['Trend post', 'warning'], lower_bid_suggestion: ['Lower bid (suggestion)', 'neutral'], new_title: ['New title', 'info'], retire_variant: ['Hide variant', 'danger'],
};
const ACTION = { enable_variant: 'Variant switched on', retire_variant: 'Variant hidden (noindex)', set_title: 'Title changed', add_links: 'Internal links added', publish_guide: 'Guide published' };
const num = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const pct = (n) => `${(Number(n || 0) * 100).toFixed(1)}%`;

async function api(body) {
  const r = await fetch('/api/seo/action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

function Th({ children, right }) { return <th className={`px-3 py-2 text-[11.5px] font-semibold uppercase tracking-wide ${right ? 'text-right' : 'text-left'}`} style={{ color: T.textMuted }}>{children}</th>; }
function Td({ children, right, mono }) { return <td className={`px-3 py-2 align-top text-[13px] ${right ? 'text-right tabular-nums' : ''} ${mono ? 'font-mono text-[12px]' : ''}`} style={{ color: T.textBody }}>{children}</td>; }
function Table({ head, children, empty }) {
  return (
    <div className="overflow-x-auto rounded-[14px]" style={CARD}>
      <table className="w-full"><thead style={{ background: T.bgSurface }}><tr>{head}</tr></thead><tbody>{children}</tbody></table>
      {empty ? <div className="px-4 py-6 text-[13px]" style={{ color: T.textMuted }}>{empty}</div> : null}
    </div>
  );
}

function evidenceLine(o) {
  const e = o.evidence || {};
  const bits = [];
  if (e.ads?.clicks) bits.push(`Ads ${num(e.ads.clicks)} clicks · ${Number(e.ads.conversions || 0).toFixed(1)} conv · US$${Number(e.ads.cost || 0).toFixed(2)}`);
  if (e.gsc?.impressions) bits.push(`Google ${num(e.gsc.impressions)} impr · pos ${e.gsc.position ?? '—'}`);
  if (e.page?.impressions) bits.push(`Google ${num(e.page.impressions)} impr · pos ${Number(e.page.position).toFixed(1)}`);
  if (e.site?.searches) bits.push(`site search ${num(e.site.searches)}×`);
  if (e.listings != null) bits.push(`${e.listings} listings`);
  if (e.traffic) bits.push(`trending ${e.trafficLabel || num(e.traffic)} searches · ${e.topic}`);
  if (e.reason) bits.push(e.reason);
  if (e.title) bits.push(`→ "${e.title}"`);
  return bits.join(' · ');
}

function Opportunities({ data, reload, busy, run }) {
  const [status, setStatus] = useState('open');
  useEffect(() => { reload({ status }); }, [status]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = data?.rows || [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {['open', 'applied', 'dismissed'].map((s) => <button key={s} type="button" onClick={() => setStatus(s)} className={btnSecondary} style={{ borderColor: T.borderLight, background: status === s ? T.bgSurface : undefined, fontWeight: status === s ? 700 : 500 }}>{s}</button>)}
        <span className="text-[12px] ml-auto" style={{ color: T.textMuted }}>Score = demand (Ads conversions, clicks, Google impressions, site searches) × listings × closeness to page 1</span>
      </div>
      <Table head={<><Th>Type</Th><Th>Search</Th><Th>Page</Th><Th>Why</Th><Th right>Score</Th><Th /></>} empty={rows.length ? null : 'Nothing here. Run Collect + Decide (top right).'}>
        {rows.map((o) => (
          <tr key={o.id} className="border-t" style={{ borderColor: T.borderLight }}>
            <Td><Pill tone={TYPE[o.type]?.[1]}>{TYPE[o.type]?.[0] || o.type}</Pill></Td>
            <Td><b>{o.term}</b></Td>
            <Td mono>{o.url || '—'}{o.page ? <div className="text-[11px]" style={{ color: T.textMuted }}>{o.page.exists ? (o.page.indexable ? 'live · indexed' : 'live · noindex') : 'no page yet'} · {o.page.count} listings</div> : null}</Td>
            <Td><span className="text-[12px]">{evidenceLine(o)}</span></Td>
            <Td right>{Number(o.score).toFixed(1)}</Td>
            <Td>{o.status === 'open' ? (
              <div className="flex gap-1.5 justify-end">
                <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.success, color: T.success }} onClick={() => run({ action: 'apply', id: o.id }, o.type === 'lower_bid_suggestion' ? 'Marked as seen (suggestion only)' : 'Applied')}>{o.type === 'lower_bid_suggestion' ? 'Got it' : o.type === 'write_guide' || o.type === 'trend_post' ? 'Draft it' : 'Apply'}</button>
                <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => run({ action: 'dismiss', id: o.id }, 'Dismissed')}>Dismiss</button>
              </div>
            ) : <span className="text-[12px]" style={{ color: T.textMuted }}>{o.status} {o.decided_by ? `by ${o.decided_by}` : ''}</span>}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function DraftEditor({ d, onSave, onCancel, busy }) {
  const [v, setV] = useState({ title: d.title, h1: d.h1, description: d.description || '', answer: d.answer || '', sections: JSON.stringify(d.sections, null, 2), faq: JSON.stringify(d.faq, null, 2) });
  const [err, setErr] = useState(null);
  const save = () => {
    try { onSave({ title: v.title, h1: v.h1, description: v.description, answer: v.answer, sections: JSON.parse(v.sections), faq: JSON.parse(v.faq) }); } catch (e) { setErr(`Sections / FAQ must be valid JSON: ${e.message}`); }
  };
  const field = (k, label, rows) => (
    <label className="block"><span className="text-[12px] font-semibold" style={{ color: T.textSecondary }}>{label}</span>
      {rows ? <textarea rows={rows} className={`${inputCls} font-mono text-[12px]`} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} /> : <input className={inputCls} value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} />}
    </label>
  );
  return (
    <div className="space-y-2 mt-3">
      {field('title', 'Title')}{field('h1', 'H1')}{field('description', 'Meta description')}{field('answer', 'Short answer', 3)}{field('sections', 'Sections (JSON: [{ h2, paras: [] }])', 10)}{field('faq', 'FAQ (JSON: [{ q, a }])', 6)}
      {err ? <Banner>{err}</Banner> : null}
      <div className="flex gap-2"><button type="button" className={btnPrimary} disabled={!!busy} onClick={save}>Save</button><button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={onCancel}>Cancel</button></div>
    </div>
  );
}

function Drafts({ data, busy, run }) {
  const [open, setOpen] = useState(null);
  const [edit, setEdit] = useState(null);
  const rows = data?.rows || [];
  const tone = { draft: 'warning', approved: 'success', rejected: 'neutral' };
  return (
    <div className="space-y-3">
      <p className="text-[12.5px]" style={{ color: T.textSecondary }}>Guides wait here until a person approves them; approved guides appear on the website&apos;s /guias at once. Numbers like <span className="font-mono">{'{{median:/alquiler/departamentos/asuncion}}'}</span> are filled from live listings on the website and refresh every month.</p>
      {!rows.length ? <Banner tone="warning">No drafts yet. On Opportunities, use “Draft it” on a guide or trend opportunity.</Banner> : null}
      {rows.map((d) => (
        <div key={d.id} className="rounded-[14px] p-4" style={CARD}>
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={tone[d.status]}>{d.status === 'approved' ? 'published' : d.status}</Pill>
            <Pill tone={d.source === 'claude' ? 'info' : 'neutral'}>{d.source === 'claude' ? `Claude${d.model ? ` · ${d.model}` : ''}` : 'Template'}</Pill>
            <span className="text-[12px] font-mono" style={{ color: T.textMuted }}>/guias/{d.slug}</span>
            <span className="text-[12px] ml-auto" style={{ color: T.textMuted }}>{fmtDate(d.updated_at, true)}</span>
          </div>
          <div className="text-[16px] font-bold mt-2" style={{ color: T.textPrimary }}>{d.h1}</div>
          <div className="text-[13px] mt-1" style={{ color: T.textBody }}>{d.answer}</div>
          {d.note ? <div className="text-[12px] mt-1" style={{ color: T.warning }}>{d.note}</div> : null}
          <div className="flex flex-wrap gap-1.5 mt-3">
            <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setOpen(open === d.id ? null : d.id)}>{open === d.id ? 'Hide' : 'Read'}</button>
            {d.status === 'draft' ? <>
              <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.success, color: T.success }} onClick={() => run({ action: 'approve', id: d.id }, 'Published on /guias')}>Approve &amp; publish</button>
              <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setEdit(edit === d.id ? null : d.id)}>Edit</button>
              <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.info, color: T.info }} onClick={() => run({ action: 'regenerate', id: d.id }, 'Regenerated')}>Regenerate with Claude</button>
              <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.danger, color: T.danger }} onClick={() => run({ action: 'reject', id: d.id }, 'Rejected')}>Reject</button>
            </> : null}
          </div>
          {edit === d.id ? <DraftEditor d={d} busy={busy} onCancel={() => setEdit(null)} onSave={(patch) => { setEdit(null); run({ action: 'edit_draft', id: d.id, patch }, 'Saved'); }} /> : null}
          {open === d.id ? (
            <div className="mt-3 space-y-3 text-[13px]" style={{ color: T.textBody }}>
              <div><b>Title:</b> {d.title}<br /><b>Description:</b> {d.description}</div>
              {(d.sections || []).map((s, i) => <div key={i}><div className="font-bold">{s.h2}</div>{(s.paras || []).map((p, j) => <p key={j} className="mt-1">{p}</p>)}</div>)}
              {(d.faq || []).length ? <div><div className="font-bold">FAQ</div>{d.faq.map((f, i) => <p key={i} className="mt-1"><b>{f.q}</b> {f.a}</p>)}</div> : null}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function Changes({ data, busy, run }) {
  const rows = data?.rows || [];
  const show = (c) => {
    if (c.action === 'set_title') return `"${c.before?.title || '(page default)'}" → "${c.after?.title}"`;
    if (c.action === 'enable_variant' || c.action === 'retire_variant') return `on: ${(c.after?.enabled_variants || []).join(', ') || '—'} · hidden: ${(c.after?.retired_variants || []).join(', ') || '—'}`;
    if (c.action === 'add_links') return `linked from ${Object.keys(c.after?.pages || {}).join(', ')}`;
    if (c.action === 'publish_guide') return 'draft → published';
    return '';
  };
  return (
    <Table head={<><Th>When</Th><Th>Page</Th><Th>Change</Th><Th>Why</Th><Th>By</Th><Th /></>} empty={rows.length ? null : 'No changes yet.'}>
      {rows.map((c) => (
        <tr key={c.id} className="border-t" style={{ borderColor: T.borderLight, opacity: c.reverted_at ? 0.55 : 1 }}>
          <Td>{fmtDate(c.created_at, true)}</Td>
          <Td mono>{c.path}</Td>
          <Td><b>{ACTION[c.action] || c.action}</b><div className="text-[12px]">{show(c)}</div></Td>
          <Td><span className="text-[12px]">{c.reason}</span></Td>
          <Td><span className="text-[12px]">{c.by}</span></Td>
          <Td>{c.reverted_at ? <span className="text-[12px]" style={{ color: T.textMuted }}>reverted {fmtDate(c.reverted_at, true)}</span>
            : <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => run({ action: 'revert', id: c.id }, 'Reverted')}>Revert</button>}</Td>
        </tr>
      ))}
    </Table>
  );
}

function Signals({ data }) {
  if (!data) return null;
  const card = (title, sub, head, rows, cells) => (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>{title}</div>
      <div className="text-[12px] mb-2" style={{ color: T.textMuted }}>{sub}</div>
      <table className="w-full"><thead><tr>{head.map((h, i) => <Th key={h} right={i > 0}>{h}</Th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className="border-t" style={{ borderColor: T.borderLight }}>{cells(r).map((c, j) => <Td key={j} right={j > 0}>{c}</Td>)}</tr>)}</tbody></table>
      {!rows.length ? <div className="text-[12.5px] py-3" style={{ color: T.textMuted }}>No data for this country.</div> : null}
    </div>
  );
  const c = data.counts || {};
  return (
    <div className="space-y-4">
    <Banner tone="warning"><b>Keyword Planner: waiting for Basic access.</b> Real search volumes for all of the country (including searches we don&apos;t rank for yet) need Google Ads API Basic access; until then demand comes from our own Ads terms, Search Console and the site search box.</Banner>
    <div className="grid gap-4 lg:grid-cols-2">
      {card('Google Ads search terms', `${num(c.ads)} terms · last 30 days · collected ${data.date || '—'}`, ['Search', 'Clicks', 'Conv.', 'Cost'], data.ads || [], (r) => [r.term, num(r.metrics.clicks), Number(r.metrics.conversions || 0).toFixed(1), `$${Number(r.metrics.cost || 0).toFixed(2)}`])}
      {card('Search Console queries', `${num(c.gsc)} query × page rows · last 28 days`, ['Search · page', 'Impr.', 'CTR', 'Pos.'], data.gsc || [], (r) => [<span key="q">{r.term}<div className="text-[11px] font-mono" style={{ color: T.textMuted }}>{r.page}</div></span>, num(r.metrics.impressions), pct(r.metrics.ctr), Number(r.metrics.position).toFixed(1)])}
      {card('Site search box', `${num(c.site_search)} searches typed on Casa-Libre · last 30 days (PostHog search_applied)`, ['Typed', 'Times', 'People'], data.site || [], (r) => [r.term, num(r.metrics.searches), num(r.metrics.people)])}
      {card('Google Trends — trending now', 'Hourly readings of the trending-searches RSS; property / economy topics become trend posts', ['Topic', 'Traffic', 'Seen'], data.trends || [], (r) => [<span key="t">{r.title} <Pill tone={r.topic === 'property' ? 'success' : r.topic === 'economy' ? 'info' : 'neutral'}>{r.topic}</Pill></span>, r.traffic_label || '—', fmtDate(r.seen_at, true)])}
    </div>
    </div>
  );
}

function Watch({ data }) {
  const rows = data?.pages || [];
  return (
    <div className="space-y-2">
      {data?.note ? <Banner tone="warning">{data.note}</Banner> : null}
      <Table head={<><Th>Page</Th><Th right>Listings</Th><Th right>Google impr.</Th><Th right>Clicks</Th><Th right>Pos.</Th><Th>Top search</Th><Th right>Ads clicks</Th><Th right>Site searches</Th><Th right>Sessions</Th><Th right>Contacts</Th></>} empty={rows.length ? null : 'No data yet.'}>
        {rows.map((r) => (
          <tr key={r.path} className="border-t" style={{ borderColor: T.borderLight }}>
            <Td mono>{r.path}{r.overridden ? <> <Pill tone="info">title</Pill></> : null}{r.indexable === false && r.exists ? <> <Pill tone="neutral">noindex</Pill></> : null}</Td>
            <Td right>{r.listings ?? '—'}</Td><Td right>{num(r.gsc.impressions)}</Td><Td right>{num(r.gsc.clicks)}</Td><Td right>{r.gsc.position ?? '—'}</Td>
            <Td><span className="text-[12px]">{r.gsc.topQuery || '—'}</span></Td>
            <Td right>{num(r.ads.clicks)}</Td><Td right>{num(r.site.searches)}</Td><Td right>{r.posthog ? num(r.posthog.sessions) : '—'}</Td><Td right>{r.posthog ? num(r.posthog.contacts) : '—'}</Td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

const SWITCHES = [
  ['collect', 'ads', 'Collect Google Ads search terms'], ['collect', 'gsc', 'Collect Search Console'], ['collect', 'site_search', 'Collect site searches (PostHog)'], ['collect', 'trends', 'Collect Google Trends'],
  [null, 'decide', 'Decide (build opportunities)'], ['auto', 'variants', 'Autopilot: add new filter pages by itself'], ['auto', 'guides', 'Autopilot: publish guides by itself'], ['auto', 'trendPosts', 'Autopilot: publish trend posts by itself'], ['improve', 'enabled', 'Daily Improve check'], ['improve', 'autoTitles', 'Improve: change low-CTR titles by itself'],
  ['improve', 'autoRetire', 'Improve: hide variants with no traffic by itself'], ['improve', 'autoLinks', 'Improve: add links to slipping pages by itself'],
  ['drafts', 'claude', 'Draft guides with Claude (else the data template)'], ['publish', 'indexNow', 'Ping Bing IndexNow on publish'],
];
const LIMITS = [
  ['minListings', 'Listings a page needs (gate)'], ['provenAdsClicks', 'Proven search: Ads clicks'], ['provenAdsConversions', 'Proven search: Ads conversions'], ['provenSiteSearches', 'Proven search: site searches'],
  ['provenGscImpressions', 'Proven search: Google impressions'], ['strengthenMinPos', 'Strengthen from position'], ['strengthenMaxPos', 'Strengthen to position'], ['strengthenMinImpressions', 'Strengthen: min impressions'],
  ['guideMinDemand', 'Guide: min demand score'], ['trendHours', 'Trend posts: max age (hours)'], ['lowCtrImpressions', 'Low CTR: min impressions'], ['lowCtr', 'Low CTR below (0.02 = 2%)'],
  ['maxNewPagesPerDay', 'Autopilot: new pages per day'], ['maxGuidesPerDay', 'Autopilot: guides per day'], ['titleDays', 'Title change: min days between'], ['zeroTrafficWeeks', 'Hide variant after N weeks with no impressions'], ['slipPositions', 'Slipping: positions lost week on week'],
];

function Settings({ data, busy, run }) {
  const [s, setS] = useState(data?.settings || null);
  useEffect(() => { setS(data?.settings || null); }, [data]);
  if (!s) return null;
  const get = (g, k) => (g ? s[g][k] : s[k]);
  const set = (g, k, v) => setS(g ? { ...s, [g]: { ...s[g], [k]: v } } : { ...s, [k]: v });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-[14px] p-4 space-y-2" style={CARD}>
        <div className="text-[15px] font-bold">Switches</div>
        {SWITCHES.map(([g, k, label]) => (
          <label key={`${g}.${k}`} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={!!get(g, k)} onChange={(e) => set(g, k, e.target.checked)} />{label}</label>
        ))}
        <div className="text-[12px] pt-2" style={{ color: T.textMuted }}>Website: <span className="font-mono">{data.website}</span>{data.devDb ? ' · local dev store (SEO_DB_URL)' : ''}. Google is read-only: the pipeline never changes ads or bids.</div>
      </div>
      <div className="rounded-[14px] p-4 space-y-2" style={CARD}>
        <div className="text-[15px] font-bold">Thresholds</div>
        {LIMITS.map(([k, label]) => (
          <label key={k} className="flex items-center justify-between gap-3 text-[13px]">{label}<input type="number" step="any" className={`${inputCls} max-w-[110px]`} value={s.thresholds[k]} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, [k]: e.target.value } })} /></label>
        ))}
      </div>
      <div><button type="button" className={btnPrimary} disabled={!!busy} onClick={() => run({ action: 'settings', settings: s }, 'Settings saved')}>Save settings</button></div>
    </div>
  );
}

export default function SeoPage() {
  const [tab, setTab] = useState('opportunities');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [extra, setExtra] = useState({});

  const reload = useCallback(async (params = extra) => {
    setLoading(true);
    setExtra(params);
    try {
      const q = new URLSearchParams({ tab, ...params });
      const r = await fetch(`/api/seo?${q}`, { cache: 'no-store' });
      setData(await r.json());
    } catch (e) { setData({ error: String(e.message || e) }); }
    setLoading(false);
  }, [tab, extra]);
  useEffect(() => { setData(null); if (tab !== 'opportunities') reload({}); }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (body, done) => {
    setBusy(body.action); setMsg(null);
    try {
      const j = await api(body);
      const note = j.result?.note || j.note || (j.draft ? `Draft saved (${j.draft.source === 'claude' ? 'Claude' : 'template'})${j.draft.note ? ` — ${j.draft.note}` : ''}` : null) || (j.source ? `Regenerated (${j.source})${j.note ? ` — ${j.note}` : ''}` : null);
      const pub = j.publish ? ` · website ${j.publish.ok ? 'updated' : `not reached (${j.publish.error || j.publish.status || j.publish.skipped || '?'}) — live within 5 min anyway`}` : '';
      const ran = j.collect || j.decide || j.improve ? ` · ${JSON.stringify(j.collect || j.decide || j.improve).slice(0, 300)}` : '';
      setMsg({ ok: true, text: `${done}${note ? ` — ${note}` : ''}${pub}${ran}` });
      await reload();
    } catch (e) { setMsg({ ok: false, text: String(e.message || e) }); }
    setBusy(null);
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="SEO"
        sub={`Automatic SEO pipeline · ${data?.country?.toUpperCase() || ''} · Collect → Understand → Decide → Create → Check → Publish → Watch → Improve`}
        action={(
          <div className="flex flex-wrap gap-1.5">
            <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => run({ action: 'run', job: 'collect' }, 'Collected')}>{busy === 'run' ? 'Running…' : 'Collect'}</button>
            <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => run({ action: 'run', job: 'decide' }, 'Decided')}>Decide</button>
            <button type="button" disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => run({ action: 'run', job: 'improve' }, 'Improve loop ran')}>Improve</button>
          </div>
        )}
      />
      <div className="flex flex-wrap gap-1 border-b" style={{ borderColor: T.borderLight }}>
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="px-3.5 py-2 text-[13.5px] -mb-px" style={{ borderBottom: `2px solid ${tab === k ? T.primary : 'transparent'}`, color: tab === k ? T.textPrimary : T.textSecondary, fontWeight: tab === k ? 700 : 500 }}>{label}</button>
        ))}
      </div>
      {msg ? <div className="text-[12.5px] px-4 py-2.5 rounded-[12px]" style={{ background: msg.ok ? T.successSurface : T.dangerSurface, color: msg.ok ? T.success : T.danger }}>{msg.text}</div> : null}
      {data?.missing ? <Banner tone="warning"><b>Not set up for this country yet.</b> Run <span className="font-mono">migrations/011_seo_pipeline.sql</span> on this country&apos;s database in the AiroBase SQL editor.</Banner> : null}
      {data?.error && !data?.missing ? <Banner>{data.error}</Banner> : null}
      {loading && !data ? <div className="text-[13px]" style={{ color: T.textMuted }}>Loading…</div> : null}
      {tab === 'opportunities' ? <Opportunities data={data} reload={reload} busy={busy} run={run} /> : null}
      {tab === 'drafts' ? <Drafts data={data} busy={busy} run={run} /> : null}
      {tab === 'changes' ? <Changes data={data} busy={busy} run={run} /> : null}
      {tab === 'signals' ? <Signals data={data} /> : null}
      {tab === 'watch' ? <Watch data={data} /> : null}
      {tab === 'settings' ? <Settings data={data} busy={busy} run={run} /> : null}
    </div>
  );
}
