'use client';
// One Admin Manager report, on ONE page, in the order the team acts on it:
//   briefing   — headline, 3–5 points, the key numbers with their trend over the last reports
//   actions    — ONE ranked list (Omar / Tahir / Roland), each with the data it rests on (read by
//                code, never by the AI) and whether its numbers passed the number check; tick
//                Done or add a note → the next runs read it. Copy for Tahir / copy the list.
//   emails     — the drafts, ready to approve & send (Preview in English, edit)
//   the loop   — what earlier reports asked for: fixed / improving / still open / worse
//   numbers    — funnel, messages, follow-ups, complaints & bots, scrapers (tables from code)
//   memory     — what the manager remembers; lessons it suggests; notes it applied
//   how it was made — cost, number check, log, the data.
// Reports written before the single-brief manager (no report.version) still open: their
// recommendations become the action list. Data: /api/manager/:id.
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { T, Banner, btnPrimary, btnSecondary, inputCls } from '@/components/automations/ui';
import EmailPreview from '@/components/manager/EmailPreview';
// the same action keys the Manager's loop uses (old reports: built from their titles)
import { slug } from '@/lib/manager/memory';
import MemoryPanel from '@/components/manager/MemoryPanel';
import PreviewEnglish from '@/components/PreviewEnglish';

const COUNTRY = { py: ['Paraguay', '.py'], bo: ['Bolivia', '.bo'], uy: ['Uruguay', '.uy'], ve: ['Venezuela', '.ve'], sv: ['El Salvador', '.sv'] };
const OWNERS = ['Omar', 'Tahir', 'Roland'];
const ROLE = { Omar: 'Lead developer', Tahir: 'Google Ads', Roland: 'CEO' };
// the specialist areas (lib/manager/brief.js SECTIONS) and which action areas belong to each
const SECTION_TABS = [['feedback', 'Feedback'], ['listings', 'Listings & payments'], ['messages', 'Messages'], ['growth', 'Traffic & ads'], ['catalog', 'Scrapers']];
const SECTION_OF = { feedback: 'feedback', listings: 'listings', payments: 'listings', messages: 'messages', growth: 'growth', ads: 'growth', catalog: 'catalog' };
const TREND = { better: [T.success, T.successSurface, 'Better'], worse: [T.danger, T.dangerSurface, 'Worse'], steady: [T.textSecondary, T.bgSurface, 'Steady'], mixed: [T.warning, T.warningSurface, 'Mixed'], too_early: [T.textSecondary, T.bgSurface, 'Too early'] };
const AREA = { feedback: 'Feedback', listings: 'Listings', payments: 'Payments', messages: 'Messages', growth: 'Traffic', ads: 'Google Ads', catalog: 'Scrapers', data: 'Data' };
const STATUS = {
  new: [T.info, T.infoSurface, 'New'],
  still_open: [T.warning, T.warningSurface, 'Still open'],
  open: [T.textSecondary, T.bgSurface, 'Open'],
  worse: [T.danger, T.dangerSurface, 'Worse'],
  reopened: [T.danger, T.dangerSurface, 'Reopened'],
  improving: [T.info, T.infoSurface, 'Improving'],
  fixed: [T.success, T.successSurface, 'Fixed'],
  done: [T.success, T.successSurface, 'Done'],
  unclear: [T.textSecondary, T.bgSurface, 'Unclear'],
  stale: [T.textSecondary, T.bgSurface, 'Not seen lately'],
};
const CLAIM = { confirmed: [T.danger, T.dangerSurface, 'Confirmed'], false_flag: [T.info, T.infoSurface, 'False flag'], unclear: [T.warning, T.warningSurface, 'Unclear'] };
const SUSPECT = { bot: [T.textSecondary, T.bgSurface, 'Bot'], real_person_bad_data: [T.warning, T.warningSurface, 'Real person, wrong data'], unclear: [T.warning, T.warningSurface, 'Unclear'] };
const KIND = {
  negative_feedback: 'Negative feedback', complaint: 'Complaint', payment_problem: 'Payment problem', listing_fix: 'Listing needs a fix',
  stuck_draft: 'Stuck draft', unpaid_listing: 'Waiting for payment', report_followup: 'Listing report', other: 'Personal email',
};
const AUTOMATION = {
  draft_reminders: 'Unfinished-draft reminders', first_listing_free_home: 'First-listing gift', listing_views_milestone: 'Listing views',
  duplicate_listings: 'Same listing twice', paid_listings: 'Paid listings', no_listing_nudge: 'No listing yet', listing_held: 'Listing not published',
  listing_saves_milestone: 'Listing getting saved', welcome: 'Welcome', account_deleted: 'Goodbye email', 'one-off': 'One-off emails',
};
const automationName = (v) => AUTOMATION[v] || String(v || '').replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
const channelName = (c) => ({ both: 'Email + WhatsApp', whatsapp_first: 'WhatsApp, then email', whatsapp: 'WhatsApp', email: 'Email' }[c] || c || '');

const when = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const day = (v) => (v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');
const fmtNum = (v, unit) => (v == null ? '—' : `${unit === 'US$' ? 'US$' : ''}${Number(v).toLocaleString('en-US', { maximumFractionDigits: unit === 'US$' ? 2 : 1 })}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rate = (v) => (v == null ? '—' : `${v}%`);
function range(start, end) {
  if (!start || !end) return '';
  const a = new Date(start), b = new Date(end);
  return `${a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${b.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}

// ── small pieces ─────────────────────────────────────────────────────────────

function Tag({ color, bg, children, title }) {
  return <span title={title} className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap" style={{ color, background: bg }}>{children}</span>;
}
function StatusTag({ status }) {
  const [c, bg, label] = STATUS[status] || STATUS.unclear;
  return <Tag color={c} bg={bg}>{label}</Tag>;
}
function Panel({ id, title, sub, right, children, flush = false }) {
  return (
    <section id={id} className="rounded-[14px] bg-white scroll-mt-4" style={{ border: `1px solid ${T.borderLight}` }}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: T.borderLight }}>
        <div className="min-w-0">
          <h2 className="text-[13.5px] font-semibold" style={{ color: T.textPrimary }}>{title}</h2>
          {sub ? <p className="text-[12px] mt-0.5 max-w-[75ch] leading-relaxed" style={{ color: T.textSecondary }}>{sub}</p> : null}
        </div>
        {right}
      </header>
      <div className={flush ? '' : 'px-5 py-1'}>{children}</div>
    </section>
  );
}
function Empty({ children }) {
  return <p className="text-[12.5px] py-5 px-5" style={{ color: T.textMuted }}>{children}</p>;
}
function OwnerDot({ owner }) {
  return <span aria-hidden className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold shrink-0" style={{ background: T.primary, color: '#fff' }}>{String(owner || '?')[0]}</span>;
}
function Segmented({ value, onChange, options, label }) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1 p-1 rounded-full" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className="text-[12px] font-medium px-3 py-1 rounded-full tabular-nums"
          style={{ background: value === v ? T.primary : 'transparent', color: value === v ? '#fff' : T.textSecondary }}>{l}</button>
      ))}
    </div>
  );
}
function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }}
      onClick={async () => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1800); } catch { window.prompt('Copy this text:', text); } }}>
      {done ? 'Copied' : label}
    </button>
  );
}

// A tiny line of one number over the last reports (hover shows each value).
function Spark({ points, unit }) {
  if (!points || points.length < 2) return null;
  const w = 96, h = 28, pad = 4;
  const vals = points.map((p) => p.v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const x = (i) => pad + (i * (w - 2 * pad)) / (points.length - 1);
  const y = (v) => (hi === lo ? h / 2 : h - pad - ((v - lo) * (h - 2 * pad)) / (hi - lo));
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Trend: ${points.map((p) => `${day(p.at)} ${fmtNum(p.v, unit)}`).join(', ')}`} className="mt-2 overflow-visible">
      <polyline fill="none" stroke={T.textMuted} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" points={points.map((p, i) => `${x(i)},${y(p.v)}`).join(' ')} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(i)} cy={y(p.v)} r={i === points.length - 1 ? 3.5 : 2.5} fill={i === points.length - 1 ? T.primary : '#fff'} stroke={i === points.length - 1 ? '#fff' : T.textMuted} strokeWidth="1.5" />
          <circle cx={x(i)} cy={y(p.v)} r="9" fill="transparent"><title>{`${day(p.at)}: ${fmtNum(p.v, unit)}`}</title></circle>
        </g>
      ))}
    </svg>
  );
}

// Tab bar: arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern). No counters.
function TabBar({ tabs, tab, setTab }) {
  const ids = tabs.map(([id]) => id);
  const onKey = (e) => {
    const i = ids.indexOf(tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const id = ids[(to + ids.length) % ids.length];
    setTab(id);
    document.getElementById(`tab-${id}`)?.focus();
  };
  return (
    <div className="sticky top-0 z-20 bg-paper">
      <div role="tablist" aria-label="Report sections" onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: T.borderLight }}>
        {tabs.map(([id, label]) => {
          const on = tab === id;
          return (
            <button key={id} id={`tab-${id}`} role="tab" type="button" aria-selected={on} aria-controls={`panel-${id}`} tabIndex={on ? 0 : -1} onClick={() => setTab(id)}
              className="relative shrink-0 px-3 py-2.5 text-[12.5px] whitespace-nowrap focus-visible:outline focus-visible:outline-2 rounded-t-md"
              style={{ color: on ? T.textPrimary : T.textSecondary, fontWeight: on ? 600 : 500 }}>
              {label}
              <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: on ? T.primary : 'transparent' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── one action ───────────────────────────────────────────────────────────────

function ActionRow({ a, rank, fb, onFeedback }) {
  const item = `action:${a.key}`;
  const f = fb[item] || {};
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(f.note || '');
  useEffect(() => { setNote(f.note || ''); }, [f.note]);
  return (
    <li className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-3 py-4 border-t first:border-t-0" style={{ borderColor: T.borderLight, opacity: f.done ? 0.6 : 1 }}>
      <span className="text-[18px] font-bold tabular-nums leading-none pt-0.5" style={{ color: T.textMuted }}>{rank}</span>
      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <p className="text-[13.5px] font-semibold leading-snug max-w-[70ch]" style={{ color: T.textPrimary, textDecoration: f.done ? 'line-through' : 'none' }}>{a.title}</p>
          <div className="flex items-center gap-1.5 shrink-0">
            <label className="inline-flex items-center gap-1.5 text-[12px] font-medium px-2 py-1 rounded-md cursor-pointer hover:bg-black/5" style={{ color: f.done ? T.success : T.textSecondary }}>
              <input type="checkbox" checked={!!f.done} onChange={(e) => onFeedback(item, { done: e.target.checked })} className="accent-current" />
              Done
            </label>
            <button type="button" onClick={() => setOpen(!open)} className="text-[12px] px-2 py-1 rounded-md hover:bg-black/5" style={{ color: f.note ? T.info : T.textSecondary }} aria-expanded={open}>{f.note ? 'Note' : 'Add note'}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <StatusTag status={a.status || 'new'} />
          {a.impact ? <Tag color={a.impact === 'high' ? T.danger : T.textSecondary} bg={a.impact === 'high' ? T.dangerSurface : T.bgSurface}>{a.impact} impact</Tag> : null}
          {a.effort ? <Tag color={T.textSecondary} bg={T.bgSurface}>{a.effort} effort</Tag> : null}
          {a.area ? <span className="text-[11.5px]" style={{ color: T.textMuted }}>{AREA[a.area] || a.area}</span> : null}
          {a.times > 1 ? <span className="text-[11.5px]" style={{ color: T.textMuted }}>raised {a.times}× since {day(a.first_seen)}</span> : null}
        </div>
        <dl className="mt-2.5 grid grid-cols-[44px_minmax(0,1fr)] gap-x-2 gap-y-1 text-[12.5px] leading-relaxed">
          <dt className="font-semibold" style={{ color: T.textSecondary }}>Why</dt><dd style={{ color: T.textBody }}>{a.why}</dd>
          <dt className="font-semibold" style={{ color: T.textSecondary }}>How</dt><dd style={{ color: T.textBody }}>{a.how}</dd>
        </dl>
        {a.evidence?.length || a.verified === false ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {(a.evidence || []).map((e) => (
              <span key={e.path} className="inline-flex items-center gap-1 text-[11.5px] px-2 py-0.5 rounded-md tabular-nums" style={{ background: T.bgSurface, color: T.textBody, border: `1px solid ${T.borderLight}` }} title="Read from the data by code">
                <span style={{ color: T.textMuted }}>{e.path}</span> {String(e.value)}
              </span>
            ))}
            {a.verified === false ? (
              <Tag color={T.warning} bg={T.warningSurface} title="A number in this action is not in the data the manager was given">
                {a.unverified?.length ? `Check: ${a.unverified.join(', ')} not found in the data` : 'No data cited'}
              </Tag>
            ) : a.verified ? <span className="text-[11.5px] font-medium" style={{ color: T.success }}>Numbers checked</span> : null}
          </div>
        ) : null}
        {open ? (
          <form className="flex flex-col sm:flex-row gap-2 mt-3" onSubmit={(e) => { e.preventDefault(); onFeedback(item, { note }); setOpen(false); }}>
            <label className="sr-only" htmlFor={`note-${a.key}`}>Note for the next reports</label>
            <input id={`note-${a.key}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Fixed on Oct 25, or: not a priority — Roland" className={inputCls} />
            <button type="submit" className={btnSecondary} style={{ borderColor: T.borderLight }}>Save note</button>
          </form>
        ) : f.note ? <p className="text-[12px] mt-2" style={{ color: T.info }}>Note: {f.note}{f.by ? ` (${f.by})` : ''}</p> : null}
      </div>
    </li>
  );
}

// One area's short section (its specialist's view), with the data its numbers come from.
function SectionHead({ sec, title }) {
  if (!sec) return <Panel title={title}><Empty>No section for this area in this report.</Empty></Panel>;
  const [c, bg, label] = TREND[sec.trend] || TREND.too_early;
  return (
    <section className="rounded-[14px] bg-white p-5" style={{ border: `1px solid ${T.borderLight}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2"><p className="text-[12px]" style={{ color: T.textSecondary }}>{title}</p><Tag color={c} bg={bg}>{label}</Tag></div>
      <h2 className="mt-2 text-[16px] font-bold leading-snug" style={{ color: T.textPrimary }}>{sec.headline}</h2>
      {sec.points?.length ? <ul className="mt-2 space-y-1 text-[12.5px] list-disc pl-5" style={{ color: T.textBody }}>{sec.points.map((x) => <li key={x}>{x}</li>)}</ul> : null}
      {sec.evidence?.length ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {sec.evidence.map((e) => <span key={e.path} className="text-[11px] px-2 py-0.5 rounded-md tabular-nums" style={{ background: T.bgSurface, color: T.textBody, border: `1px solid ${T.borderLight}` }}><span style={{ color: T.textMuted }}>{e.path}</span> {String(e.value)}</span>)}
        </div>
      ) : null}
    </section>
  );
}

// ── a drafted email ─────────────────────────────────────────────────────────

const englishText = (v) => [v.subject ? `Subject: ${v.subject}` : '', v.heading || '', v.body || '', v.button_label ? `Button: ${v.button_label}` : ''].filter(Boolean).join('\n\n');

function Draft({ a, busy, onAct, site, tld }) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const blank = () => ({ subject: a.subject, heading: a.heading, body: a.body, button_label: a.button_label || '', button_url: a.button_url || '' });
  const [f, setF] = useState(blank);
  useEffect(() => { setF(blank()); }, [a]); // eslint-disable-line react-hooks/exhaustive-deps
  const sent = a.status === 'sent';
  const dismissed = a.status === 'dismissed';
  const host = site ? site.replace(/^https?:\/\//, '') : 'casa-libre.com.py';
  const view = edit ? f : a;
  return (
    <li className="border-t first:border-t-0" style={{ borderColor: T.borderLight }}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="min-w-0 flex-1 text-left">
          <span className="flex flex-wrap items-center gap-2">
            <Tag color={T.info} bg={T.infoSurface}>{KIND[a.kind] || a.kind}</Tag>
            {sent ? <Tag color={T.success} bg={T.successSurface}>Sent</Tag> : dismissed ? <Tag color={T.textSecondary} bg={T.bgSurface}>Dismissed</Tag> : null}
            <span className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{a.subject}</span>
          </span>
          <span className="block text-[12px] mt-0.5" style={{ color: T.textSecondary }}>{a.reason}</span>
        </button>
        {!sent && !dismissed && !edit ? (
          <div className="flex items-center gap-2">
            <button type="button" disabled={busy} className={btnPrimary} onClick={() => { if (window.confirm('Send this email to the person now?')) onAct('send', a); }}>Approve &amp; send</button>
            <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Read'}</button>
          </div>
        ) : null}
      </div>
      {open ? (
        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 px-5 pb-5">
          <div className="min-w-0 text-[12px] space-y-2" style={{ color: T.textBody }}>
            {a.evidence ? <p><span className="font-semibold" style={{ color: T.textSecondary }}>Based on:</span> {a.evidence}</p> : null}
            {a.property_id ? <p><a href={`${site}/propiedad/${a.property_id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">Open the listing</a></p> : null}
            {sent ? <p>Sent {when(a.sent_at)} to {a.sent_to}{a.sent_by ? `, by ${a.sent_by}` : ''}</p> : null}
            {edit ? (
              <div className="space-y-2.5">
                {[['subject', 'Subject'], ['heading', 'Heading']].map(([k, l]) => (
                  <label key={k} className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>{l}<input className={`${inputCls} mt-1`} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
                ))}
                <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Message<textarea className={`${inputCls} mt-1`} rows={8} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
                <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Button text<input className={`${inputCls} mt-1`} value={f.button_label} onChange={(e) => setF({ ...f, button_label: e.target.value })} placeholder="Optional" /></label>
                <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Button link<input className={`${inputCls} mt-1`} value={f.button_url} onChange={(e) => setF({ ...f, button_url: e.target.value })} placeholder={`${site}/cuenta/publicaciones`} /></label>
                <div className="flex gap-2">
                  <button type="button" disabled={busy} className={btnPrimary} onClick={async () => { if (await onAct('edit', a, f)) setEdit(false); }}>Save changes</button>
                  <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => { setF(blank()); setEdit(false); }}>Cancel</button>
                </div>
              </div>
            ) : !sent ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {dismissed ? <button type="button" disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => onAct('restore', a)}>Move back to review</button> : (
                  <>
                    <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setEdit(true)}>Edit</button>
                    <button type="button" disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => onAct('dismiss', a)}>Dismiss</button>
                  </>
                )}
              </div>
            ) : null}
          </div>
          <div className="min-w-0">
            <EmailPreview subject={view.subject} heading={view.heading} body={view.body} buttonLabel={view.button_label} buttonUrl={view.button_url} tld={tld} from={`Casa Libre <hola@${host}>`} />
            <PreviewEnglish key={englishText(view)} text={englishText(view)} />
          </div>
        </div>
      ) : null}
    </li>
  );
}

// ── tables from the data (code, not AI) ─────────────────────────────────────

function Table({ head, rows, numeric = [], min = 640 }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px] tabular-nums" style={{ minWidth: min }}>
        <thead><tr style={{ color: T.textSecondary, background: T.bgSurface }}>
          {head.map((h, i) => <th key={h} scope="col" className={`py-2.5 px-3 first:pl-5 last:pr-5 font-semibold text-[11.5px] ${numeric.includes(i) ? 'text-right' : 'text-left'}`}>{h}</th>)}
        </tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t" style={{ borderColor: T.borderLight, color: T.textBody }}>
              {r.map((c, j) => <td key={j} className={`py-2.5 px-3 first:pl-5 last:pr-5 ${numeric.includes(j) ? 'text-right' : ''}`}>{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Funnel: one bar per step, this period; the previous period as text.
function Funnel({ funnel }) {
  const max = Math.max(1, ...funnel.map((f) => f.thisWeek || 0));
  return (
    <ul className="px-5 py-4 space-y-2.5">
      {funnel.map((f) => (
        <li key={f.step} className="grid grid-cols-[150px_minmax(0,1fr)_120px] items-center gap-3 text-[12px]">
          <span style={{ color: T.textBody }}>{f.step}</span>
          <span className="h-3 rounded-[4px]" style={{ background: T.bgSurface }} title={`${f.step}: ${f.thisWeek} (was ${f.previousWeek})`}>
            <span className="block h-3 rounded-[4px]" style={{ width: `${Math.max(1, ((f.thisWeek || 0) / max) * 100)}%`, background: T.primary }} />
          </span>
          <span className="text-right tabular-nums" style={{ color: T.textPrimary }}>
            {fmtNum(f.thisWeek)} <span style={{ color: f.changePct > 0 ? T.success : f.changePct < 0 ? T.danger : T.textMuted }}>{f.changePct == null ? '' : `${f.changePct > 0 ? '▲' : f.changePct < 0 ? '▼' : '='}${Math.abs(f.changePct)}%`}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

// ── page ────────────────────────────────────────────────────────────────────

export default function ManagerReportPage({ params }) {
  const [row, setRow] = useState(null);
  const [site, setSite] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [composing, setComposing] = useState(null);
  const [msg, setMsg] = useState('');
  const [owner, setOwner] = useState('all');
  const [emailTab, setEmailTab] = useState('draft');
  const [numbersTab, setNumbersTab] = useState('messages');
  const [tab, setTabState] = useState('overview');
  // the open tab lives in the URL hash (#emails), so links and reloads keep it
  useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (h) setTabState(h); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setTab = useCallback((id) => { setTabState(id); window.history.replaceState(null, '', `#${id}`); }, []);

  const load = useCallback(() => {
    fetch(`/api/manager/${params.id}`).then((r) => r.json())
      .then((j) => { if (j.error) setErr(j.error); else { setErr(''); setRow(j.report); setSite(j.site || ''); } })
      .catch(() => setErr('The report could not be loaded. Check your connection and reload.'));
  }, [params.id]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (row?.status !== 'running') return undefined;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [row?.status, load]);

  const patch = async (body) => {
    const r = await fetch(`/api/manager/${params.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  };
  // shows the change at once; the server's copy replaces it (or it rolls back on failure)
  const onFeedback = async (item, fields) => {
    const before = row?.feedback || {};
    setRow((x) => ({ ...x, feedback: { ...(x.feedback || {}), [item]: { ...(x.feedback?.[item] || {}), item, ...fields } } }));
    const { ok, j } = await patch({ op: 'feedback', item, ...fields });
    if (ok) setRow((x) => ({ ...x, feedback: j.feedback }));
    else { setRow((x) => ({ ...x, feedback: before })); setMsg('That did not save. Try again.'); }
  };
  const onAct = async (op, a, fields = {}) => {
    setBusy(true); setMsg('');
    const { ok, j } = await patch({ op, actionId: a.id, ...fields });
    setBusy(false);
    if (!ok) { setMsg(j.errors ? Object.values(j.errors).join(' ') : (j.error || 'That did not work. Try again.')); return false; }
    setRow((x) => ({ ...x, actions: x.actions.map((d) => (d.id === a.id ? j.action : d)) }));
    if (op === 'send') setMsg(`Email sent to ${j.action.sent_to}.`);
    return true;
  };
  const compose = async (source, index) => {
    setComposing(`${source}:${index}`); setMsg('');
    const { ok, j } = await patch({ op: 'compose', source, index });
    setComposing(null);
    if (!ok) { setMsg(j.message || j.error || 'The draft could not be written. Try again.'); return; }
    setRow((x) => ({ ...x, actions: [...(x.actions || []), j.action] }));
    setEmailTab('draft');
    setMsg('Draft written: it is in Emails, ready to read and approve.');
  };

  const r = row?.report || {};
  const pack = row?.data_pack || {};
  const fb = row?.feedback || {};
  const drafts = useMemo(() => row?.actions || [], [row?.actions]);

  // the action list (old reports: their ranked recommendations), with the loop's info
  const actions = useMemo(() => {
    const list = Array.isArray(r.actions) && r.version >= 2 ? r.actions : (r.recommendations || []).map((x) => ({ ...x, key: slug(x.title), status: 'new' }));
    const tr = new Map((r.tracker || []).map((t) => [t.key, t]));
    return list.map((a, i) => ({ ...a, rank: i + 1, times: tr.get(a.key)?.times, first_seen: tr.get(a.key)?.first_seen }));
  }, [r]);
  const actionKeys = new Set(actions.map((a) => a.key));
  const earlier = (r.tracker || []).filter((t) => !actionKeys.has(t.key));
  const checkBy = new Map((r.followup_checks || []).map((c) => [c.key, c]));

  const counts = { draft: drafts.filter((a) => a.status === 'draft').length, sent: drafts.filter((a) => a.status === 'sent').length, dismissed: drafts.filter((a) => a.status === 'dismissed').length };
  const [countryName, tld] = COUNTRY[row?.country] || [String(row?.country || '').toUpperCase(), '.py'];
  const period = range(row?.period_start, row?.period_end);

  if (err) {
    return (
      <div className="space-y-4">
        <Link href="/manager" className="text-[12.5px] underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>← All reports</Link>
        <Banner>{err === 'not_found' ? 'This report does not exist in the selected country. Switch country in the header or go back to all reports.' : err}</Banner>
      </div>
    );
  }
  if (!row) return <p className="text-[12.5px]" style={{ color: T.textMuted }}>Loading the report…</p>;

  const shown = actions.filter((a) => owner === 'all' || a.owner === owner);
  const groups = OWNERS.map((o) => [o, shown.filter((a) => a.owner === o)]).filter(([, l]) => l.length);

  const tahir = r.tahir && (r.tahir.facts?.length || r.tahir.actions?.length) ? r.tahir : null;
  const tahirText = tahir ? [
    `Google Ads — Casa Libre ${countryName} (${period})`, '', 'Facts:', ...tahir.facts.map((x) => `- ${x}`), '', 'To do:', ...tahir.actions.map((x) => `- ${x}`),
  ].join('\n') : '';
  const listText = [
    `Admin Manager — ${countryName}, ${period}`, r.headline || '', '',
    ...OWNERS.flatMap((o) => {
      const l = actions.filter((a) => a.owner === o && !fb[`action:${a.key}`]?.done);
      return l.length ? [`${o}:`, ...l.map((a) => `${a.rank}. ${a.title} — ${a.how}`), ''] : [];
    }),
  ].join('\n');

  // the trend of each key number over the last reports
  const trendOf = (label) => (r.trend || []).map((t) => ({ at: t.at, v: (t.kpis || []).find((k) => k.label === label)?.value })).filter((p) => p.v != null);
  const kpis = r.kpis || pack.kpis || [];
  const claims = (r.claim_checks || []).map((x, i) => ({ x, i }));
  const suspicious = (r.suspicious || []).map((x, i) => ({ x, i }));
  const hasDraft = (x) => drafts.some((a) => (x.user_id && a.user_id === x.user_id) || (x.feedback_id && String(a.feedback_id) === String(x.feedback_id)));
  const timing = pack.messageTiming?.rows || [];
  const scorecard = pack.automations?.followUpsPreviousWeekFullResults || [];
  const scrapers = pack.scrapers?.last14Days || [];
  const guard = r.guard;
  const sections = new Map((r.sections || []).map((x) => [x.id, x]));
  const areaTabs = r.version >= 2 ? SECTION_TABS : [];
  const tabs = [['overview', 'Overview'], ...areaTabs, ['emails', 'Emails'], ...(r.tracker ? [['loop', 'Earlier actions']] : []), ...(areaTabs.length ? [] : [['numbers', 'Numbers']]), ['memory', 'Memory'], ['method', 'How it was made']];
  const actionsIn = (id) => actions.filter((a) => SECTION_OF[a.area] === id);
  const funnelBlock = Array.isArray(pack.traffic?.funnel) ? <Funnel funnel={pack.traffic.funnel} /> : <Empty>No visitor data in this report.</Empty>;
  const messagesTables = (
              timing.length || scorecard.length ? (
                <>
                  {timing.length ? (
                    <Table min={760} numeric={[2, 3, 4, 5, 6]} head={['Automation', 'Channel', 'Sent', 'Bounced', 'Opened', 'Clicked / read', 'Acted in 7 days', 'Best send hours']} rows={timing.map((t) => {
                      const best = [...(t.bySendHourLocal || [])].filter((h) => h.sent >= 3).sort((a, b) => (b.rate || 0) - (a.rate || 0))[0];
                      return [automationName(t.automation), channelName(t.channel), t.sent, t.channel === 'email' ? rate(t.bounceRate) : '—', t.channel === 'email' ? rate(t.openRate) : '—', t.channel === 'email' ? rate(t.clickRate) : rate(t.readRate), t.actedWithin7Days, best ? `${best.hours} h (${rate(best.rate)})` : '—'];
                    })} />
                  ) : null}
                  {scorecard.length ? (
                    <>
                      <p className="px-5 pt-4 pb-2 text-[12.5px] font-semibold border-t" style={{ color: T.textPrimary, borderColor: T.borderLight }}>Previous week, full 7 days: what people did after each message</p>
                      <Table min={680} numeric={[2, 3, 4, 5, 6]} head={['Automation', 'Channel', 'Sent', 'People', 'Listed', 'Paid', 'Came back']} rows={scorecard.map((x) => [automationName(x.automation), channelName(x.channel), x.sent, x.matched, `${x.listed}${x.listedRate != null ? ` · ${x.listedRate}%` : ''}`, x.paid, `${x.active}${x.activeRate != null ? ` · ${x.activeRate}%` : ''}`])} />
                    </>
                  ) : null}
                  <p className="px-5 py-3 text-[12px]" style={{ color: T.textMuted }}>Opens are inflated by Apple Mail; clicks and actions are the honest signal. Last 30 days unless noted.</p>
                </>
              ) : <Empty>No messages in this report.</Empty>
  );
  const feedbackTable = (
              claims.length || suspicious.length ? (
                <Table min={760} head={['Who / what', 'Verdict', 'Why', '']} rows={[
                  ...claims.map(({ x, i }) => {
                    const [c, bg, l] = CLAIM[x.verdict] || CLAIM.unclear;
                    return [<span key="w"><span className="font-medium" style={{ color: T.textPrimary }}>{x.who}</span><span className="block text-[11.5px] italic" style={{ color: T.textMuted }}>“{x.claim}”</span></span>, <Tag key="v" color={c} bg={bg}>{l}</Tag>, x.reason,
                      x.verdict !== 'confirmed' ? (hasDraft(x) ? <span key="d" style={{ color: T.success }}>Draft in Emails</span> : <button key="d" type="button" disabled={composing === `claim:${i}`} onClick={() => compose('claim', i)} className={btnSecondary} style={{ borderColor: T.borderLight }}>{composing === `claim:${i}` ? 'Writing…' : 'Draft an email'}</button>) : ''];
                  }),
                  ...suspicious.map(({ x, i }) => {
                    const [c, bg, l] = SUSPECT[x.verdict] || SUSPECT.unclear;
                    return [<span key="w" className="font-medium" style={{ color: T.textPrimary }}>{x.title}</span>, <Tag key="v" color={c} bg={bg}>{l}</Tag>, x.reason,
                      x.verdict !== 'bot' && (x.user_id || x.feedback_id) ? (hasDraft(x) ? <span key="d" style={{ color: T.success }}>Draft in Emails</span> : <button key="d" type="button" disabled={composing === `suspicious:${i}`} onClick={() => compose('suspicious', i)} className={btnSecondary} style={{ borderColor: T.borderLight }}>{composing === `suspicious:${i}` ? 'Writing…' : 'Draft an email'}</button>) : ''];
                  }),
                ]} />
              ) : <Empty>No complaints to check and no bots this time.</Empty>
  );
  const scrapersTable = (
              scrapers.length ? (
                <Table min={640} numeric={[1, 2, 3, 4]} head={['Scraper', 'Runs (14 days)', 'Failed', 'New', 'Live listings', 'Last run']} rows={scrapers.filter((x) => x.active).map((x) => [x.name || x.key, x.runs, x.failed, x.inserted, x.liveListings ?? '—', `${day(x.lastRun)} · ${x.lastStatus || '—'}`])} />
              ) : <Empty>No scraper data in this report.</Empty>
  );
  const L = pack.listings || {}, P = pack.payments || {};
  const listingsTable = L.newThisWeek || P.thisWeek ? (
    <Table min={520} numeric={[1, 2]} head={['', 'This period', 'Previous']} rows={[
      ['New owner listings', L.newThisWeek?.total ?? '—', L.newPreviousWeek?.total ?? '—'],
      ['Sellers', L.newThisWeek?.sellers ?? '—', L.newPreviousWeek?.sellers ?? '—'],
      ['First-time sellers', L.firstTimeSellersThisWeek ?? '—', '—'],
      ['Payments succeeded', P.thisWeek?.succeeded ?? '—', P.previousWeek?.succeeded ?? '—'],
      ['Payments failed', P.thisWeek?.failed ?? '—', P.previousWeek?.failed ?? '—'],
      ['Checkouts started', P.thisWeek?.checkoutsStarted ?? '—', P.previousWeek?.checkoutsStarted ?? '—'],
      ['Checkouts abandoned', P.thisWeek?.checkoutsAbandoned ?? '—', P.previousWeek?.checkoutsAbandoned ?? '—'],
      ['Revenue', fmtNum(P.thisWeek?.revenueUsd, 'US$'), fmtNum(P.previousWeek?.revenueUsd, 'US$')],
      ['Unfinished drafts (3+ days)', pack.drafts?.stuckOver3Days ?? '—', '—'],
    ]} />
  ) : <Empty>No listing data in this report.</Empty>;
  const tahirBlock = tahir ? (
    <Panel title="For Tahir (Google Ads)" right={<CopyButton text={tahirText} label="Copy for Tahir" />}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 py-4 text-[12.5px]" style={{ color: T.textBody }}>
        <div><p className="text-[12px] font-semibold mb-1.5" style={{ color: T.textSecondary }}>Facts</p><ul className="space-y-1 list-disc pl-5">{tahir.facts.map((x) => <li key={x}>{x}</li>)}</ul></div>
        <div><p className="text-[12px] font-semibold mb-1.5" style={{ color: T.textSecondary }}>To do</p><ul className="space-y-1 list-disc pl-5">{tahir.actions.map((x) => <li key={x}>{x}</li>)}</ul></div>
      </div>
    </Panel>
  ) : null;
  const panel = (id) => ({ id: `panel-${id}`, role: 'tabpanel', 'aria-labelledby': `tab-${id}`, hidden: tab !== id, className: 'space-y-5' });

  return (
    <div className="pb-16 space-y-6">
      <Link href="/manager" className="text-[12.5px] underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>← All reports</Link>

      {/* ── briefing ── */}
      <header className="rounded-[18px] p-6 sm:p-8 bg-white" style={{ border: `1px solid ${T.borderLight}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3 text-[12.5px]" style={{ color: T.textSecondary }}>
          <p>{countryName}, {period || day(row.created_at)}</p>
          <div className="flex items-center gap-2 text-[12px]">
            {row.status === 'done' ? <Tag color={T.success} bg={T.successSurface}>Ready</Tag> : row.status === 'running' ? <Tag color={T.info} bg={T.infoSurface}>Being written</Tag> : <Tag color={T.danger} bg={T.dangerSurface}>Failed</Tag>}
            {row.cost_usd != null ? <span style={{ color: T.textMuted }}>US${Number(row.cost_usd).toFixed(2)}</span> : null}
          </div>
        </div>
        <h1 className="mt-4 text-[20px] sm:text-[22px] font-bold leading-[1.15] max-w-[34ch]" style={{ color: T.textPrimary, letterSpacing: '-0.025em' }}>
          {r.headline || (row.status === 'running' ? 'The manager is reading the numbers…' : 'This report could not be written')}
        </h1>
        {(r.points || []).length ? (
          <ul className="mt-3 space-y-1.5 text-[13.5px] max-w-[80ch]" style={{ color: T.textBody }}>
            {r.points.map((p, i) => <li key={i} className="flex gap-2.5 leading-snug"><span aria-hidden className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: T.textMuted }} />{p}</li>)}
          </ul>
        ) : r.summary ? <p className="mt-3 text-[13.5px] max-w-[80ch]" style={{ color: T.textBody }}>{r.summary}</p> : null}
      </header>

      {row.status !== 'done' ? (
        <Panel title={row.status === 'running' ? 'Working' : 'What went wrong'} sub={row.status === 'running' ? 'This takes a minute or two; you can leave this page.' : row.error}>
          <ol className="space-y-2 border-l pl-4 my-4" style={{ borderColor: T.borderLight }}>
            {(row.log || []).map((l, i) => <li key={i} className="text-[12.5px] leading-relaxed" style={{ color: T.textBody }}><span className="tabular-nums mr-2" style={{ color: T.textMuted }}>{when(l.at)}</span>{l.text}</li>)}
          </ol>
        </Panel>
      ) : (
        <>
          <TabBar tabs={tabs} tab={tab} setTab={setTab} />
          {msg ? <Banner tone="warning">{msg}</Banner> : null}

          <div {...panel('overview')}>

          {/* ── key numbers (code) ── */}
          {kpis.length ? (
            <section aria-label="Key numbers" className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-[14px] overflow-hidden" style={{ background: T.borderLight, border: `1px solid ${T.borderLight}` }}>
              {kpis.map((k) => {
                const up = k.changePct > 0, down = k.changePct < 0;
                return (
                  <div key={k.label} className="p-4 bg-white">
                    <p className="text-[12px]" style={{ color: T.textSecondary }}>{k.label}</p>
                    <p className="text-[18px] font-bold tabular-nums mt-0.5" style={{ color: T.textPrimary, letterSpacing: '-0.02em' }}>{fmtNum(k.value, k.unit)}</p>
                    <p className="text-[12px] tabular-nums" style={{ color: up ? T.success : down ? T.danger : T.textMuted }}>
                      {k.changePct == null ? (k.previous == null ? 'No earlier number' : `Was ${fmtNum(k.previous, k.unit)}`) : `${up ? '▲' : down ? '▼' : '='} ${Math.abs(k.changePct)}%, was ${fmtNum(k.previous, k.unit)}`}
                    </p>
                    <Spark points={trendOf(k.label)} unit={k.unit} />
                  </div>
                );
              })}
            </section>
          ) : null}

          {/* ── the areas, one line each ── */}
          {sections.size ? (
            <section aria-label="Areas" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-px rounded-[14px] overflow-hidden" style={{ background: T.borderLight, border: `1px solid ${T.borderLight}` }}>
              {SECTION_TABS.map(([id, label]) => {
                const sec = sections.get(id);
                const [c, bg, tl] = TREND[sec?.trend] || TREND.too_early;
                return (
                  <button key={id} type="button" onClick={() => setTab(id)} className="text-left p-4 bg-white hover:bg-[#FAF7F1] focus-visible:outline focus-visible:outline-2">
                    <span className="flex items-center justify-between gap-2"><span className="text-[12px] font-semibold" style={{ color: T.textPrimary }}>{label}</span><Tag color={c} bg={bg}>{tl}</Tag></span>
                    <span className="block text-[12px] mt-1.5 leading-snug" style={{ color: T.textBody }}>{sec?.headline || '—'}</span>
                  </button>
                );
              })}
            </section>
          ) : null}

          {/* ── actions ── */}
          <Panel id="actions" title="Actions" sub="Tick Done or add a note — the next report checks it." flush
            right={(
              <div className="flex flex-wrap items-center gap-2">
                <Segmented label="Show actions for" value={owner} onChange={setOwner} options={[['all', 'Everyone'], ...OWNERS.map((o) => [o, o])]} />
                <CopyButton text={listText} label="Copy list" />
              </div>
            )}>
            {groups.map(([o, list]) => (
              <div key={o} className="px-5 pt-4 pb-1 border-t first:border-t-0" style={{ borderColor: T.borderLight }}>
                <p className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: T.textPrimary }}><OwnerDot owner={o} />{o}<span className="font-normal text-[12px]" style={{ color: T.textMuted }}>{ROLE[o]}</span></p>
                <ol className="mt-1">{list.map((a) => <ActionRow key={a.key} a={a} rank={a.rank} fb={fb} onFeedback={onFeedback} />)}</ol>
              </div>
            ))}
            {!groups.length ? <Empty>{owner === 'all' ? 'No actions this time.' : `Nothing for ${owner}.`}</Empty> : null}
          </Panel>

          {/* ── for Tahir ── */}
          {tahirBlock}

          </div>

          {/* ── emails ── */}
          <div {...panel('emails')}>
          <Panel id="emails" title="Emails to send" sub="Sent automatically when the report is written. Ones you ask for with “Draft an email” wait here for you." flush
            right={<Segmented label="Email status" value={emailTab} onChange={setEmailTab} options={[['draft', 'To review'], ['sent', 'Sent'], ['dismissed', 'Dismissed']]} />}>
            {drafts.filter((a) => a.status === emailTab).length ? (
              <ul>{drafts.filter((a) => a.status === emailTab).map((a) => <Draft key={a.id} a={a} busy={busy} onAct={onAct} site={site} tld={tld} />)}</ul>
            ) : <Empty>{emailTab === 'draft' ? (drafts.length ? 'All drafts are handled.' : 'No one needs a personal email this time.') : emailTab === 'sent' ? 'Nothing sent yet.' : 'Nothing dismissed.'}</Empty>}
          </Panel>

          </div>

          {/* ── the loop ── */}
          <div {...panel('loop')}>
          {r.tracker ? (
            <Panel id="loop" title="Earlier actions" sub="Checked against this period's numbers." flush>
              {earlier.length ? (
                <Table min={720} head={['Action', 'Owner', 'First raised', 'Status', 'What the numbers say']} rows={earlier.map((t) => {
                  const c = checkBy.get(t.key);
                  return [
                    <span key="t" className="font-medium" style={{ color: T.textPrimary }}>{t.title}</span>,
                    t.owner,
                    `${day(t.first_seen)}${t.times > 1 ? ` (${t.times}×)` : ''}`,
                    <StatusTag key="s" status={t.status} />,
                    <span key="e">{c?.evidence || t.last_check?.evidence || '—'}{c && c.verified === false ? <span style={{ color: T.warning }}> (check: {c.unverified.join(', ')})</span> : null}</span>,
                  ];
                })} />
              ) : <Empty>Nothing open from earlier reports.</Empty>}
            </Panel>
          ) : null}

          </div>

          {/* ── one tab per area: its section, its actions, its numbers (code) ── */}
          {areaTabs.map(([id, label]) => (
            <div key={id} {...panel(id)}>
              <SectionHead sec={sections.get(id)} title={label} />
              {actionsIn(id).length ? (
                <Panel title="Actions" flush>
                  <ol className="px-5">{actionsIn(id).map((a) => <ActionRow key={a.key} a={a} rank={a.rank} fb={fb} onFeedback={onFeedback} />)}</ol>
                </Panel>
              ) : null}
              {id === 'feedback' ? <Panel title="Complaints & bots" sub="From the data, no AI." flush>{feedbackTable}</Panel> : null}
              {id === 'listings' ? <Panel title="Listings & money" sub="From the data, no AI." flush>{listingsTable}</Panel> : null}
              {id === 'messages' ? <Panel title="Messages" sub="From the data, no AI." flush>{messagesTables}</Panel> : null}
              {id === 'growth' ? (
                <>
                  <Panel title="Visitors" sub="This period; % vs the previous one." flush>{funnelBlock}</Panel>
                  {tahirBlock}
                </>
              ) : null}
              {id === 'catalog' ? <Panel title="Scrapers" sub="Last 14 days, from the data." flush>{scrapersTable}</Panel> : null}
            </div>
          ))}

          {/* ── old reports (before the areas): the numbers in one tab ── */}
          {!areaTabs.length ? (
            <div {...panel('numbers')}>
              <Panel title="The numbers" sub="From the data, no AI." flush
                right={<Segmented label="Numbers" value={numbersTab} onChange={setNumbersTab} options={[['messages', 'Messages'], ['funnel', 'Visitors'], ['feedback', 'Complaints & bots'], ['scrapers', 'Scrapers']]} />}>
                {numbersTab === 'funnel' ? funnelBlock : numbersTab === 'messages' ? messagesTables : numbersTab === 'feedback' ? feedbackTable : scrapersTable}
              </Panel>
            </div>
          ) : null}

          {/* ── memory ── */}
          <div {...panel('memory')}>
          {(r.notes_applied || []).length ? (
            <Panel title="Notes the manager followed this time">
              <ul className="py-3 space-y-1 text-[12.5px] list-disc pl-5" style={{ color: T.textBody }}>{r.notes_applied.map((x) => <li key={x}>{x}</li>)}</ul>
            </Panel>
          ) : null}
          <MemoryPanel suggestions={r.memory_suggestions || []} />

          </div>

          {/* ── how it was made ── */}
          <div {...panel('method')}>
          <Panel title="How this report was made" flush>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden" style={{ background: T.borderLight }}>
              {[
                ['Cost', row.cost_usd != null ? `US$${Number(row.cost_usd).toFixed(2)}` : '—'],
                ['Read', r.history_used ? `${plural(r.history_used.reports, 'earlier report')}, ${plural(r.history_used.adminNotes, 'note')}, ${plural(r.memory_used || 0, 'memory note')}` : '—'],
                ['Number check', guard ? `${guard.checked} checked, ${guard.unverified.length} not found` : '—'],
                ['Finished', when(row.finished_at)],
              ].map(([k, v]) => (
                <div key={k} className="p-4 bg-white"><dt className="text-[12px]" style={{ color: T.textSecondary }}>{k}</dt><dd className="text-[12.5px] font-semibold mt-0.5" style={{ color: T.textPrimary }}>{v}</dd></div>
              ))}
            </dl>
            {guard?.unverified?.length || guard?.removedPoints?.length ? (
              <details className="border-t" style={{ borderColor: T.borderLight }}>
                <summary className="cursor-pointer px-5 py-3.5 text-[12.5px] font-semibold" style={{ color: T.textPrimary }}>Numbers the check could not find</summary>
                <ul className="px-5 pb-5 space-y-1 text-[12px]" style={{ color: T.textBody }}>
                  {guard.unverified.map((u, i) => <li key={i}><span className="font-medium">{u.where}</span>: {u.numbers.join(', ')} — “{u.text}”{guard.removedPoints.includes(u.text) ? ' (removed)' : ''}</li>)}
                </ul>
              </details>
            ) : null}
            <details className="border-t" style={{ borderColor: T.borderLight }}>
              <summary className="cursor-pointer px-5 py-3.5 text-[12.5px] font-semibold" style={{ color: T.textPrimary }}>Run log</summary>
              <ol className="px-5 pb-5 space-y-1.5">
                {(row.log || []).map((l, i) => <li key={i} className="text-[12px] leading-relaxed" style={{ color: T.textBody }}><span className="tabular-nums mr-2" style={{ color: T.textMuted }}>{when(l.at)}</span>{l.text}</li>)}
              </ol>
            </details>
            <details className="border-t" style={{ borderColor: T.borderLight }}>
              <summary className="cursor-pointer px-5 py-3.5 text-[12.5px] font-semibold" style={{ color: T.textPrimary }}>All the data it was given</summary>
              <pre className="mx-5 mb-5 text-[11px] p-4 rounded-lg overflow-auto max-h-[480px]" style={{ background: T.bgSurface, color: T.textBody }}>{JSON.stringify(pack, null, 2)}</pre>
            </details>
          </Panel>
          </div>
        </>
      )}
    </div>
  );
}
