'use client';

import { useEffect, useMemo, useState } from 'react';
import { Search, X, ExternalLink, Filter } from 'lucide-react';
import { T, CARD, PageHeader, Pill, Banner, fmtDate } from '@/components/automations/ui';
import {
  SITE_LABEL, SITE_DOMAIN, SITE_FIELDS, FUNNEL_STATUSES, STATUS_LABEL, LEAD_RANGES, DEFAULT_LEAD_DAYS, waLink, utmOf,
} from '@/lib/funnelLeads';

// Admin → Funnels: the two Spanish funnel sites (owners: vender-mi-casa, agents:
// como-vender-mas-propiedades). Leads come from the active country's DB (funnel_leads);
// Analytics from PostHog (events with funnel_site set). /api/funnels/*

const STATUS_TONE = { new: 'info', contacted: 'warning', converted: 'success', discarded: 'neutral' };
const n = (v) => Number(v || 0).toLocaleString('en-US');
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');

function Segmented({ value, onChange, options, label }) {
  return (
    <div className="flex items-center gap-1 p-1 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }} role="group" aria-label={label}>
      {options.map(([k, l]) => (
        <button key={k} type="button" onClick={() => onChange(k)} className="px-3 py-1 rounded-full text-[12.5px] font-medium whitespace-nowrap"
          style={value === k ? { background: T.textPrimary, color: '#fff' } : { color: T.textBody }}>{l}</button>
      ))}
    </div>
  );
}

const selectCls = 'text-[12.5px] px-3 py-1.5 border rounded-full bg-white';
const selectSt = { borderColor: T.borderLight, color: T.textBody };

function Stat({ label, value, hint, tone }) {
  return (
    <div className="bg-white px-4 py-3" style={CARD}>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{label}</p>
      <p className="text-[22px] font-bold mt-0.5" style={{ color: tone || T.textPrimary }}>{value}</p>
      {hint ? <p className="text-[11px] mt-0.5 leading-snug" style={{ color: T.textMuted }}>{hint}</p> : null}
    </div>
  );
}

// ── Leads tab ────────────────────────────────────────────────────────────────────────────
function LeadsTab() {
  const [site, setSite] = useState('all');
  const [status, setStatus] = useState('all');
  const [days, setDays] = useState(DEFAULT_LEAD_DAYS);
  const [q, setQ] = useState('');
  const [qLive, setQLive] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null);
  const [reload, setReload] = useState(0);

  useEffect(() => { const t = setTimeout(() => setQ(qLive), 300); return () => clearTimeout(t); }, [qLive]);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    const qs = new URLSearchParams({ site, status, days: String(days), q });
    fetch(`/api/funnels/leads?${qs}`, { cache: 'no-store' })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => { if (alive) setData(ok ? j : { ...j, error: j?.error || 'Could not load leads' }); })
      .catch(() => { if (alive) setData({ error: 'Could not load leads' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [site, status, days, q, reload]);

  const rows = data?.rows || [];
  const c = data?.counts;
  const country = (data?.country || '').toUpperCase();

  const onSaved = (row) => {
    setData((d) => (d ? { ...d, rows: d.rows.map((r) => (r.id === row.id ? row : r)) } : d));
    setOpen(row);
    setReload((x) => x + 1);   // refresh the counts
  };

  return (
    <div className="space-y-4">
      {data?.missing ? (
        <Banner tone="warning">
          <b>Run the funnel_leads migration on this country&apos;s database</b> ({country || 'current country'}). The funnel sites save
          their leads to <span className="font-mono">public.funnel_leads</span>; once the table exists, leads show up here.
        </Banner>
      ) : null}
      {data?.error && !data?.missing ? <Banner>{data.error}</Banner> : null}

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Stat label="New" value={c ? n(c.status.new) : '—'} hint="Not contacted yet" tone={T.info} />
        <Stat label="Contacted" value={c ? n(c.status.contacted) : '—'} hint="We reached out" tone={T.warning} />
        <Stat label="Converted" value={c ? n(c.status.converted) : '—'} hint="Listed or became a client" tone={T.success} />
        <Stat label="Owners site" value={c ? n(c.site.owners) : '—'} hint={`Leads from ${SITE_DOMAIN.owners}`} />
        <Stat label="Agents site" value={c ? n(c.site.agents) : '—'} hint={`Leads from ${SITE_DOMAIN.agents}`} />
      </div>
      <p className="text-[11.5px] -mt-1" style={{ color: T.textMuted }}>
        Counts cover the date range below for {country || 'this country'} (every site and status).
      </p>

      <div className="flex flex-col lg:flex-row gap-2 lg:items-center flex-wrap">
        <label className="flex-1 min-w-[220px] flex items-center gap-2 px-3 py-2 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }}>
          <Search className="w-4 h-4" style={{ color: T.textMuted }} />
          <input value={qLive} onChange={(e) => setQLive(e.target.value)} placeholder="Search name, WhatsApp or email…" className="flex-1 bg-transparent outline-none text-[13px]" />
        </label>
        <Segmented label="Site" value={site} onChange={setSite} options={[['all', 'All sites'], ['owners', 'Owners'], ['agents', 'Agents']]} />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} style={selectSt} aria-label="Status">
          <option value="all">All statuses</option>
          {FUNNEL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={selectCls} style={selectSt} aria-label="Date range">
          {LEAD_RANGES.map((r) => <option key={r.v} value={r.v}>{r.v ? `Last ${r.l}` : r.l}</option>)}
        </select>
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 640, overflow: 'auto' }}>
          <table className="w-full min-w-[1100px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Date', 'Site', 'Page', 'Name', 'WhatsApp', 'Email', 'Details', 'UTM source / campaign', 'Status'].map((h) => (
                  <th key={h} className="px-3 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left whitespace-nowrap" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && !data ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(9)].map((__, j) => <td key={j} className="px-3 py-3"><div className="h-3 rounded" style={{ width: 70, background: T.bgSurface }} /></td>)}
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-6 py-12 text-center text-sm" style={{ color: T.textSecondary }}>
                  {data?.missing ? 'No table yet on this country\'s database.' : (c?.total ? 'No leads match these filters.' : 'No funnel leads in this period yet.')}
                </td></tr>
              ) : rows.map((r) => {
                const u = utmOf(r);
                const fields = (SITE_FIELDS[r.site] || []).map(([k]) => r[k]).filter(Boolean);
                return (
                  <tr key={r.id} onClick={() => setOpen(r)} className="border-b cursor-pointer transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }} data-testid="funnel-lead-row">
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: T.textBody }}>{fmtDate(r.created_at, true)}</td>
                    <td className="px-3 py-2.5"><Pill tone={r.site === 'owners' ? 'ink' : 'neutral'}>{SITE_LABEL[r.site] || r.site}</Pill></td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap" style={{ color: T.textBody }}>
                      <span className="font-mono">{(r.country || '').toUpperCase()}</span>{r.page ? <span style={{ color: T.textMuted }}> · {r.page}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-[13px] font-medium max-w-[180px] truncate" style={{ color: T.textPrimary }} title={r.name}>{r.name}</td>
                    <td className="px-3 py-2.5 text-xs whitespace-nowrap">
                      {waLink(r.whatsapp) ? (
                        <a href={waLink(r.whatsapp)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 hover:underline" style={{ color: T.success }} title="Open in WhatsApp">
                          {r.whatsapp}<ExternalLink className="w-3 h-3" />
                        </a>
                      ) : <span style={{ color: T.textMuted }}>{r.whatsapp || '—'}</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-[180px] truncate">
                      {r.email ? <a href={`mailto:${r.email}`} onClick={(e) => e.stopPropagation()} className="hover:underline" style={{ color: T.textBody }} title={r.email}>{r.email}</a> : <span style={{ color: T.textMuted }}>—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-xs max-w-[260px] truncate" style={{ color: T.textBody }} title={fields.join(' · ')}>{fields.join(' · ') || '—'}</td>
                    <td className="px-3 py-2.5 text-xs max-w-[180px] truncate" style={{ color: T.textBody }}>{[u.source, u.campaign].filter(Boolean).join(' / ') || <span style={{ color: T.textMuted }}>—</span>}</td>
                    <td className="px-3 py-2.5"><Pill tone={STATUS_TONE[r.status] || 'neutral'}>{STATUS_LABEL[r.status] || r.status || 'New'}</Pill></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {data?.capped ? <p className="text-[11.5px]" style={{ color: T.textMuted }}>Showing the newest 5,000 leads of this period.</p> : null}

      {open ? <LeadDrawer lead={open} onClose={() => setOpen(null)} onSaved={onSaved} /> : null}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-2 py-1.5 border-b text-[12.5px]" style={{ borderColor: T.borderLight }}>
      <span style={{ color: T.textSecondary }}>{label}</span>
      <span className="break-words" style={{ color: T.textPrimary }}>{children ?? <span style={{ color: T.textMuted }}>—</span>}</span>
    </div>
  );
}

const asJson = (v) => {
  if (v == null || v === '') return null;
  let o = v;
  if (typeof o === 'string') { try { o = JSON.parse(o); } catch { return String(v); } }
  if (typeof o !== 'object') return String(o);
  const entries = Object.entries(o);
  if (!entries.length) return null;
  return (
    <span className="block space-y-0.5">
      {entries.map(([k, val]) => <span key={k} className="block"><span style={{ color: T.textSecondary }}>{k}:</span> {typeof val === 'object' ? JSON.stringify(val) : String(val)}</span>)}
    </span>
  );
};

// Every field of one lead, plus the status / notes form (the only write on this page).
function LeadDrawer({ lead, onClose, onSaved }) {
  const [status, setStatus] = useState(lead.status || 'new');
  const [notes, setNotes] = useState(lead.notes || '');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setStatus(lead.status || 'new'); setNotes(lead.notes || ''); setErr(''); }, [lead]);
  const dirty = status !== (lead.status || 'new') || notes !== (lead.notes || '');

  const save = async () => {
    setSaving(true); setErr('');
    try {
      const res = await fetch(`/api/funnels/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status, notes }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Could not save');
      onSaved(j.row);
    } catch (e) { setErr(String(e.message || e)); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose} role="dialog" aria-modal="true">
      <div className="absolute inset-0" style={{ background: 'rgba(17,17,17,0.25)' }} />
      <div className="relative w-full max-w-[480px] h-full bg-white overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()} style={{ borderLeft: `1px solid ${T.borderLight}` }}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[18px] font-bold" style={{ color: T.textPrimary }}>{lead.name}</p>
            <p className="text-[12px]" style={{ color: T.textSecondary }}>
              {SITE_LABEL[lead.site] || lead.site} site · {(lead.country || '').toUpperCase()} · {fmtDate(lead.created_at, true)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-full hover:bg-black/5"><X className="w-5 h-5" /></button>
        </div>

        <div className="space-y-2 p-3 rounded-[14px]" style={{ background: T.bgSurface }}>
          <div className="flex items-center gap-2">
            <label className="text-[12px] font-semibold w-16" style={{ color: T.textSecondary }}>Status</label>
            <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} style={selectSt}>
              {FUNNEL_STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="Notes (call outcome, next step…)"
            className="w-full px-3 py-2 rounded-[10px] border text-[13px] outline-none bg-white" style={{ borderColor: T.borderLight }} />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px]" style={{ color: T.textMuted }}>
              {lead.handled_by ? `Last handled by ${lead.handled_by} · ${fmtDate(lead.handled_at, true)}` : 'Not handled yet'}
            </span>
            <button type="button" onClick={save} disabled={!dirty || saving}
              className="px-4 py-1.5 rounded-full text-[12.5px] font-semibold disabled:opacity-40" style={{ background: T.textPrimary, color: '#fff' }}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
          {err ? <p className="text-[12px]" style={{ color: T.danger }}>{err}</p> : null}
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>Contact</p>
          <Field label="WhatsApp">{waLink(lead.whatsapp) ? <a href={waLink(lead.whatsapp)} target="_blank" rel="noreferrer" className="hover:underline" style={{ color: T.success }}>{lead.whatsapp}</a> : lead.whatsapp}</Field>
          <Field label="Email">{lead.email ? <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a> : null}</Field>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>Form answers</p>
          {(SITE_FIELDS[lead.site] || []).map(([k, l]) => <Field key={k} label={l}>{lead[k]}</Field>)}
          <Field label="Page">{lead.page}</Field>
          <Field label="Form location">{lead.form_location}</Field>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>Consent</p>
          <Field label="Consent">{asJson(lead.consent)}</Field>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>Where they came from</p>
          <Field label="UTM">{asJson(lead.utm)}</Field>
          <Field label="Referrer">{lead.referrer}</Field>
          <Field label="PostHog ID"><span className="font-mono text-[11.5px]">{lead.posthog_distinct_id}</span></Field>
          <Field label="IP"><span className="font-mono text-[11.5px]">{lead.ip}</span></Field>
          <Field label="Browser"><span className="text-[11.5px]">{lead.user_agent}</span></Field>
          <Field label="Lead ID"><span className="font-mono text-[11px]">{lead.id}</span></Field>
        </div>
      </div>
    </div>
  );
}

// ── Analytics tab ────────────────────────────────────────────────────────────────────────
function MiniBars({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.visitors));
  return (
    <div>
      <div className="flex items-end gap-[3px] h-[120px]">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col justify-end h-full group relative" title={`${d.date}: ${d.visitors} visitors · ${d.pageviews} views · ${d.leads} leads`}>
            <div className="rounded-t-[3px]" style={{ height: `${(d.visitors / max) * 100}%`, minHeight: d.visitors ? 2 : 0, background: T.textPrimary }} />
            {d.leads ? <div className="absolute left-0 right-0 -top-1 mx-auto w-1.5 h-1.5 rounded-full" style={{ background: T.success }} /> : null}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] mt-1" style={{ color: T.textMuted }}>
        <span>{daily[0]?.date}</span><span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Table({ head, rows, empty = 'No data in this period.' }) {
  return (
    <table className="w-full">
      <thead><tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${i ? 'text-right' : 'text-left'}`} style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length ? rows.map((r, i) => (
          <tr key={i} className="border-b" style={{ borderColor: T.borderLight }}>
            {r.map((v, j) => <td key={j} className={`px-3 py-2 text-[12.5px] ${j ? 'text-right tabular-nums' : 'text-left'}`} style={{ color: j ? T.textBody : T.textPrimary }}>{v}</td>)}
          </tr>
        )) : <tr><td colSpan={head.length} className="px-3 py-6 text-center text-[12.5px]" style={{ color: T.textMuted }}>{empty}</td></tr>}
      </tbody>
    </table>
  );
}

function Panel({ title, sub, children }) {
  return (
    <div className="bg-white overflow-hidden" style={CARD}>
      <div className="px-4 pt-3 pb-2">
        <p className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>{title}</p>
        {sub ? <p className="text-[11.5px]" style={{ color: T.textMuted }}>{sub}</p> : null}
      </div>
      {children}
    </div>
  );
}

function AnalyticsTab() {
  const [days, setDays] = useState(7);
  const [site, setSite] = useState('all');
  const [scope, setScope] = useState('active');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/funnels/analytics?days=${days}&site=${site}&country=${scope}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive) setData(j); })
      .catch(() => { if (alive) setData({ error: 'Could not load analytics' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [days, site, scope]);

  const t = data?.totals;
  const v = (x) => (loading && !t ? '…' : n(x));
  const countryLabel = data?.country === 'all' ? 'all countries' : (data?.country || '').toUpperCase();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Site" value={site} onChange={setSite} options={[['all', 'Both sites'], ['owners', 'Owners'], ['agents', 'Agents']]} />
        <Segmented label="Country" value={scope} onChange={setScope} options={[['active', 'This country'], ['all', 'All countries']]} />
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={`${selectCls} ml-auto`} style={selectSt} aria-label="Period">
          {[7, 28, 90].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        {loading ? <span className="text-[11px]" style={{ color: T.textMuted }}>Loading…</span> : null}
      </div>

      {data?.configured === false ? <Banner tone="warning">PostHog is not connected (POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID).</Banner> : null}
      {data?.error ? <Banner>{data.error}</Banner> : null}

      <p className="text-[11.5px]" style={{ color: T.textMuted }}>
        Funnel-site events only (PostHog events carrying <span className="font-mono">funnel_site</span>), {countryLabel || 'this country'}, last {days} days.
        These visits are not counted in the main Analytics page&apos;s site numbers.
      </p>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="Visitors" value={v(t?.visitors)} hint="Unique people (signed-in by account, others by IP) who opened a funnel page." />
        <Stat label="Page views" value={v(t?.pageviews)} hint="Every page opened, repeat views included." />
        <Stat label="Form starts" value={v(t?.formStarts)} hint={`Times someone began the form · ${t ? n(t.formStarters) : '—'} people.`} />
        <Stat label="Form steps done" value={v(t?.stepCompletes)} hint="Form steps completed (multi-step forms count each step)." />
        <Stat label="Leads" value={v(t?.leads)} tone={T.success} hint={`Forms sent (generate_lead) · ${t ? n(t.leadPeople) : '—'} people.`} />
        <Stat label="Conversion" value={t ? `${t.conversion}%` : '—'} tone={T.success} hint="Share of visitors who sent the form (people with a lead ÷ visitors)." />
        <Stat label="Casa-Libre clicks" value={v(t?.clClicks)} hint={`Clicks on links to Casa-Libre · ${t ? n(t.clClickers) : '—'} people.`} />
        <Stat label="Start → lead" value={t ? pct(t.leadPeople, t.formStarters) : '—'} hint="Of the people who started the form, how many sent it." />
      </div>

      <Panel title="Daily visitors" sub="Bars = unique visitors per day (country time zone). A green dot marks a day with at least one lead.">
        <div className="px-4 pb-4">{data?.daily?.length ? <MiniBars daily={data.daily} /> : <p className="text-[12.5px] py-6 text-center" style={{ color: T.textMuted }}>No data yet.</p>}</div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Panel title="By site" sub="Owners = vender-mi-casa · Agents = como-vender-mas-propiedades.">
          <Table head={['Site', 'Visitors', 'Views', 'Leads', 'CL clicks']}
            rows={(data?.bySite || []).map((r) => [SITE_LABEL[r.site] || r.site, n(r.visitors), n(r.pageviews), n(r.leads), n(r.clClicks)])} />
        </Panel>
        {data?.country === 'all' ? (
          <Panel title="By country" sub="The country section of the funnel site the visitor was on (funnel_country).">
            <Table head={['Country', 'Visitors', 'Views', 'Leads']}
              rows={(data?.byCountry || []).map((r) => [String(r.country).toUpperCase(), n(r.visitors), n(r.pageviews), n(r.leads)])} />
          </Panel>
        ) : (
          <Panel title="Traffic sources" sub="Where visitors came from: utm_source when the link was tagged, else the referring site, else direct.">
            <Table head={['Source', 'Visitors', 'Views', 'Leads']}
              rows={(data?.sources || []).map((r) => [r.source, n(r.visitors), n(r.pageviews), n(r.leads)])} />
          </Panel>
        )}
      </div>

      <Panel title="Top pages" sub="Each funnel page (funnel_page): views, unique visitors, form starts, leads sent there, and lead rate (leads ÷ visitors).">
        <div className="overflow-x-auto">
          <Table head={['Page', 'Views', 'Visitors', 'Form starts', 'Leads', 'Lead rate', 'CL clicks']}
            rows={(data?.pages || []).map((r) => [
              <span key="p"><span className="text-[11px] mr-1.5" style={{ color: T.textMuted }}>{SITE_LABEL[r.site] || r.site}</span>{r.page}</span>,
              n(r.views), n(r.visitors), n(r.formStarts), n(r.leads), pct(r.leads, r.visitors), n(r.clClicks),
            ])} />
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {data?.country === 'all' ? (
          <Panel title="Traffic sources" sub="Where visitors came from: utm_source when the link was tagged, else the referring site, else direct.">
            <Table head={['Source', 'Visitors', 'Views', 'Leads']}
              rows={(data?.sources || []).map((r) => [r.source, n(r.visitors), n(r.pageviews), n(r.leads)])} />
          </Panel>
        ) : null}
        <Panel title="Casa-Libre link clicks" sub="Clicks from the funnel sites to Casa-Libre, by where the link sits on the page (position) and its utm_content.">
          <Table head={['Position', 'utm_content', 'Clicks', 'People']}
            rows={(data?.clicks || []).map((r) => [r.position, r.content, n(r.clicks), n(r.people)])} />
        </Panel>
      </div>
    </div>
  );
}

export default function FunnelsPage() {
  const [tab, setTab] = useState('leads');
  const [seen, setSeen] = useState({ leads: true });
  useEffect(() => { setSeen((s) => ({ ...s, [tab]: true })); }, [tab]);
  const tabs = useMemo(() => [['leads', 'Leads'], ['analytics', 'Analytics']], []);

  return (
    <div className="space-y-5">
      <PageHeader title="Funnels"
        sub="The two Spanish funnel sites: owners (vender-mi-casa) and agents (como-vender-mas-propiedades). Leads are read from the selected country's database; analytics from PostHog." />
      <div className="flex items-center gap-6 border-b" style={{ borderColor: T.borderLight }}>
        {tabs.map(([k, l]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className="pb-2.5 -mb-px text-[14px] font-semibold border-b-2 transition-colors inline-flex items-center gap-1.5"
            style={tab === k ? { borderColor: T.textPrimary, color: T.textPrimary } : { borderColor: 'transparent', color: T.textSecondary }}>
            {k === 'analytics' ? <Filter className="w-3.5 h-3.5" /> : null}{l}
          </button>
        ))}
      </div>
      <div hidden={tab !== 'leads'}><LeadsTab /></div>
      <div hidden={tab !== 'analytics'}>{seen.analytics ? <AnalyticsTab /> : null}</div>
    </div>
  );
}
