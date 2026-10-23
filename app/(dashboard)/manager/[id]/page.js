'use client';
// One Admin Manager report. Five researchers each wrote one section (lib/manager/team.js) and
// the lead wrote the briefing on top, so the page reads like that:
//   Overview — the lead's headline, key numbers, the ranked priorities, one card per researcher
//   one tab per researcher — its verdict, what got better / worse, its own checks (false
//     flags and bots, bad listings, send timing …), its next steps and tasks
//   Emails — the drafts (live inbox previews, Preview in English, edit → Approve & send)
//   How it was made — cost, the researchers' notes, run log, the data.
// The open tab is kept in the URL (#feedback …). 👍 / 👎 + notes on any item are saved on the
// report and read by next week's run. "Draft an email" on a false flag / flagged item asks for
// one on demand (/api/manager/:id op compose). Data: /api/manager/:id.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { T, Banner, btnPrimary, btnSecondary, inputCls } from '@/components/automations/ui';
import EmailPreview from '@/components/manager/EmailPreview';
import PreviewEnglish from '@/components/PreviewEnglish';

const COUNTRY = { py: ['Paraguay', '.py'], bo: ['Bolivia', '.bo'], uy: ['Uruguay', '.uy'], ve: ['Venezuela', '.ve'], sv: ['El Salvador', '.sv'] };
const OWNERS = ['Omar', 'Tahir', 'Roland'];
const ROLE = { Omar: 'Lead developer', Tahir: 'Google Ads', Roland: 'CEO' };
const SEV_ORDER = ['high', 'medium', 'low'];
const SEVERITY = { high: [T.danger, T.dangerSurface, 'High priority'], medium: [T.warning, T.warningSurface, 'Medium priority'], low: [T.textSecondary, T.bgSurface, 'Low priority'] };
const VERDICT = {
  working: [T.success, T.successSurface, 'Working'],
  weak: [T.warning, T.warningSurface, 'Weak'],
  no_effect: [T.danger, T.dangerSurface, 'No visible effect'],
  costly: [T.danger, T.dangerSurface, 'Costs more than it brings'],
  too_early: [T.textSecondary, T.bgSurface, 'Too early to tell'],
};
const TREND = {
  better: [T.success, T.successSurface, 'Better than before'],
  worse: [T.danger, T.dangerSurface, 'Worse than before'],
  steady: [T.textSecondary, T.bgSurface, 'Steady'],
  mixed: [T.warning, T.warningSurface, 'Mixed'],
  too_early: [T.textSecondary, T.bgSurface, 'Too early to tell'],
};
const CLAIM = {
  confirmed: [T.danger, T.dangerSurface, 'Confirmed'],
  false_flag: [T.info, T.infoSurface, 'False flag'],
  unclear: [T.warning, T.warningSurface, 'Unclear'],
};
const SUSPECT = {
  bot: [T.textSecondary, T.bgSurface, 'Bot'],
  real_person_bad_data: [T.warning, T.warningSurface, 'Real person, wrong data'],
  unclear: [T.warning, T.warningSurface, 'Unclear'],
};
const SUSPECT_KIND = { bot_feedback: 'Bot feedback', bot_signup: 'Bot sign-up', listing_data: 'Listing data', spam: 'Spam' };
const CONFIDENCE = { high: [T.success, T.successSurface], medium: [T.info, T.infoSurface], low: [T.textSecondary, T.bgSurface] };
const KIND = {
  negative_feedback: 'Negative feedback', complaint: 'Complaint', payment_problem: 'Payment problem', listing_fix: 'Listing needs a fix',
  stuck_draft: 'Stuck draft', unpaid_listing: 'Waiting for payment', report_followup: 'Listing report', other: 'Personal email',
};
const AUTOMATION = {
  draft_reminders: 'Unfinished-draft reminders', first_listing_free_home: 'First-listing gift', listing_views_milestone: 'Listing views',
  duplicate_listings: 'Same listing twice', paid_listings: 'Paid listings', no_listing_nudge: 'No listing yet', listing_held: 'Listing not published',
  listing_saves_milestone: 'Listing getting saved', welcome: 'Welcome', account_deleted: 'Goodbye email', 'one-off': 'One-off emails',
};
const automationName = (s) => {
  const raw = String(s || '');
  const key = raw.split(/[\s(·]/)[0];
  if (AUTOMATION[key]) return raw.replace(key, AUTOMATION[key]);
  return raw.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
};
const channelName = (c) => ({ both: 'Email and WhatsApp', whatsapp_first: 'WhatsApp first, then email', whatsapp: 'WhatsApp', email: 'Email' }[c] || c || '');

// The researchers, in the order of their tabs (ids match lib/manager/team.js).
const RESEARCH = [
  ['feedback', 'Feedback', 'Ratings, complaints, false flags, bots'],
  ['listings', 'Original listings & payments', 'Owner listings, rent vs sale, bad listings, money'],
  ['followups', 'Follow-ups & messages', 'Email and WhatsApp results, send timing'],
  ['growth', 'Traffic & marketing', 'Visitors, sources, funnel, Google Ads'],
  ['catalog', 'Scrapers & catalog', 'Scraper health, catalog size'],
];

const d = (v) => (v ? new Date(v) : null);
function weekRange(start, end) {
  const a = d(start), b = d(end);
  if (!a || !b) return '';
  const md = { month: 'short', day: 'numeric' };
  const sameMonth = a.getMonth() === b.getMonth();
  return `${a.toLocaleDateString('en-US', md)} – ${sameMonth ? b.getDate() : b.toLocaleDateString('en-US', md)}, ${b.getFullYear()}`;
}
const when = (v) => (v ? new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const fmtNum = (v, unit) => (v == null ? '—' : `${unit === 'US$' ? 'US$' : ''}${Number(v).toLocaleString('en-US', { maximumFractionDigits: unit === 'US$' ? 2 : 1 })}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const rate = (v) => (v == null ? '—' : `${v}%`);

// ── small pieces ─────────────────────────────────────────────────────────────

function Thumb({ down, on }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={down ? { transform: 'rotate(180deg)' } : undefined} aria-hidden>
      <path d="M7 10v11H3V10h4zM7 10l4-8a2.5 2.5 0 0 1 3 2.6L13.5 9H19a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 17.6 21H7" />
    </svg>
  );
}

// 👍 / 👎 + note on one item; next week's run reads them.
function Vote({ item, feedback, onSave }) {
  const f = feedback?.[item] || {};
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(f.note || '');
  const iconBtn = (v) => (
    <button
      type="button"
      aria-label={v === 'up' ? 'Mark as useful' : 'Mark as wrong or not useful'}
      aria-pressed={f.vote === v}
      onClick={() => onSave(item, f.vote === v ? null : v, f.note || '')}
      className="p-1 rounded-md hover:bg-black/5 focus-visible:outline focus-visible:outline-2"
      style={{ color: f.vote === v ? (v === 'up' ? T.success : T.danger) : T.textMuted }}
    ><Thumb down={v === 'down'} on={f.vote === v} /></button>
  );
  return (
    <div className="shrink-0">
      <div className="flex items-center gap-0.5">
        {iconBtn('up')}{iconBtn('down')}
        <button type="button" onClick={() => setOpen(!open)} className="text-[11px] px-1.5 py-1 rounded-md hover:bg-black/5" style={{ color: f.note ? T.info : T.textMuted }}>{f.note ? 'Note' : 'Add note'}</button>
      </div>
      {open ? (
        <div className="flex items-center gap-1.5 mt-1.5">
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Already fixed on Oct 21" className="text-xs px-2.5 py-1.5 rounded-lg border w-60 bg-white" style={{ borderColor: T.borderLight }} />
          <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => { onSave(item, f.vote || null, note); setOpen(false); }}>Save</button>
        </div>
      ) : null}
    </div>
  );
}

// Every block on the page: a white card with a header row (title, line under it, controls)
// and its content below a rule.
function Panel({ title, sub, right, children, flush = false }) {
  return (
    <section className="rounded-[14px] bg-white" style={{ border: `1px solid ${T.borderLight}` }}>
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b" style={{ borderColor: T.borderLight }}>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold" style={{ color: T.textPrimary }}>{title}</h2>
          {sub ? <p className="text-[12.5px] mt-0.5 max-w-[75ch] leading-relaxed" style={{ color: T.textSecondary }}>{sub}</p> : null}
        </div>
        {right}
      </header>
      <div className={flush ? '' : 'px-5 py-1'}>{children}</div>
    </section>
  );
}

// A list row inside a Panel (rows are split by a hairline).
function Row({ children, className = '' }) {
  return <div className={`py-4 border-t first:border-t-0 ${className}`} style={{ borderColor: T.borderLight }}>{children}</div>;
}

function Empty({ children }) {
  return <p className="text-[13px] py-5" style={{ color: T.textMuted }}>{children}</p>;
}

function Evidence({ children }) {
  if (!children) return null;
  return <p className="text-[12px] mt-2 leading-relaxed" style={{ color: T.textMuted }}><span className="font-medium" style={{ color: T.textSecondary }}>Based on:</span> {children}</p>;
}

function OwnerTag({ owner }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] font-medium" style={{ color: T.textBody }}>
      <span className="inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-bold" style={{ background: T.primary, color: '#fff' }}>{String(owner || '?')[0]}</span>
      {owner}
    </span>
  );
}

function Tag({ color, bg, children }) {
  return <span className="inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-md whitespace-nowrap" style={{ color, background: bg }}>{children}</span>;
}

function ImpactTags({ x }) {
  const tone = x.impact === 'high' ? [T.success, T.successSurface] : x.impact === 'medium' ? [T.info, T.infoSurface] : [T.textSecondary, T.bgSurface];
  return (
    <>
      {x.impact ? <Tag color={tone[0]} bg={tone[1]}>{x.impact} impact</Tag> : null}
      {x.effort ? <Tag color={T.textSecondary} bg={T.bgSurface}>{x.effort} effort</Tag> : null}
    </>
  );
}

function SeverityBar({ severity, children }) {
  const [c] = SEVERITY[severity] || SEVERITY.low;
  return <div className="pl-3.5" style={{ borderLeft: `3px solid ${c}` }}>{children}</div>;
}

// A text button that opens another tab.
function GoTo({ to, onGo, children }) {
  return (
    <button type="button" onClick={() => onGo(to)} className="text-[12.5px] font-semibold underline-offset-2 hover:underline" style={{ color: T.textPrimary }}>{children}</button>
  );
}

function OwnerFilter({ owner, setOwner }) {
  return (
    <div role="group" aria-label="Filter by person" className="flex flex-wrap gap-1 p-1 rounded-full" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
      {['Everyone', ...OWNERS].map((o) => (
        <button key={o} type="button" aria-pressed={owner === o} onClick={() => setOwner(o)} className="text-[12px] font-medium px-3 py-1 rounded-full"
          style={{ background: owner === o ? T.primary : 'transparent', color: owner === o ? '#fff' : T.textSecondary }}>{o}</button>
      ))}
    </div>
  );
}

// ── a drafted email ─────────────────────────────────────────────────────────

// The whole email as one text for "Preview in English" (same translation as Reports /
// Feedback: /api/translate-preview). A changed draft gets a fresh translation.
const englishText = (v) => [
  v.subject ? `Subject: ${v.subject}` : '',
  v.heading || '',
  v.body || '',
  v.button_label ? `Button: ${v.button_label}` : '',
].filter(Boolean).join('\n\n');

function Draft({ a, busy, onAct, site, tld }) {
  const [edit, setEdit] = useState(false);
  const blank = () => ({ subject: a.subject, heading: a.heading, body: a.body, button_label: a.button_label || '', button_url: a.button_url || '' });
  const [f, setF] = useState(blank);
  useEffect(() => { setF(blank()); }, [a]); // eslint-disable-line react-hooks/exhaustive-deps
  const sent = a.status === 'sent';
  const dismissed = a.status === 'dismissed';
  const host = site ? site.replace(/^https?:\/\//, '') : 'casa-libre.com.py';
  const view = edit ? f : a;

  return (
    <article className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-5 p-5 rounded-[14px] bg-white" style={{ border: `1px solid ${T.borderLight}` }}>
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <Tag color={T.info} bg={T.infoSurface}>{KIND[a.kind] || a.kind}</Tag>
          {sent ? <Tag color={T.success} bg={T.successSurface}>Sent</Tag> : dismissed ? <Tag color={T.textSecondary} bg={T.bgSurface}>Dismissed</Tag> : <Tag color={T.warning} bg={T.warningSurface}>Waiting for review</Tag>}
        </div>
        <h3 className="text-[15px] font-semibold mt-3 leading-snug" style={{ color: T.textPrimary }}>{a.reason}</h3>
        <Evidence>{a.evidence}</Evidence>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          {a.user_id ? <><dt style={{ color: T.textMuted }}>Account</dt><dd className="truncate" title={a.user_id} style={{ color: T.textBody }}>{a.user_id}</dd></> : null}
          {a.feedback_id ? <><dt style={{ color: T.textMuted }}>Feedback</dt><dd className="truncate" style={{ color: T.textBody }}>{a.feedback_id} (uses the email they left)</dd></> : null}
          {a.property_id ? <><dt style={{ color: T.textMuted }}>Listing</dt><dd className="truncate"><a href={`${site}/propiedad/${a.property_id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2" style={{ color: T.textBody }}>Open on the site</a></dd></> : null}
          {sent ? <><dt style={{ color: T.textMuted }}>Sent</dt><dd style={{ color: T.textBody }}>{when(a.sent_at)} to {a.sent_to}{a.sent_by ? `, by ${a.sent_by}` : ''}</dd></> : null}
          {a.edited_by ? <><dt style={{ color: T.textMuted }}>Edited</dt><dd style={{ color: T.textBody }}>{when(a.edited_at)} by {a.edited_by}</dd></> : null}
        </dl>

        {!sent ? (
          <div className="flex flex-wrap items-center gap-2 mt-5">
            {edit ? (
              <>
                <button type="button" disabled={busy} className={btnPrimary} onClick={async () => { if (await onAct('edit', a, f)) setEdit(false); }}>Save changes</button>
                <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => { setF(blank()); setEdit(false); }}>Cancel</button>
              </>
            ) : dismissed ? (
              <button type="button" disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => onAct('restore', a)}>Move back to review</button>
            ) : (
              <>
                <button type="button" disabled={busy} className={btnPrimary} onClick={() => { if (window.confirm('Send this email to the person now?')) onAct('send', a); }}>Approve &amp; send</button>
                <button type="button" disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setEdit(true)}>Edit</button>
                <button type="button" disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => onAct('dismiss', a)}>Dismiss</button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <div className="min-w-0">
        {edit ? (
          <div className="space-y-2.5 mb-4">
            <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Subject
              <input className={`${inputCls} mt-1`} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
            </label>
            <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Heading
              <input className={`${inputCls} mt-1`} value={f.heading} onChange={(e) => setF({ ...f, heading: e.target.value })} />
            </label>
            <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Message <span style={{ color: T.textMuted }}>(blank line = new paragraph · **bold** · [text](link))</span>
              <textarea className={`${inputCls} mt-1`} rows={9} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Button text
                <input className={`${inputCls} mt-1`} value={f.button_label} onChange={(e) => setF({ ...f, button_label: e.target.value })} placeholder="Optional" />
              </label>
              <label className="block text-[12px] font-medium" style={{ color: T.textSecondary }}>Button link
                <input className={`${inputCls} mt-1`} value={f.button_url} onChange={(e) => setF({ ...f, button_url: e.target.value })} placeholder={`${site}/cuenta/publicaciones`} />
              </label>
            </div>
            <p className="text-[12px]" style={{ color: T.textMuted }}>Preview updates as you type.</p>
          </div>
        ) : null}
        <EmailPreview subject={view.subject} heading={view.heading} body={view.body} buttonLabel={view.button_label} buttonUrl={view.button_url} tld={tld} from={`Casa Libre <hola@${host}>`} />
        {/* the email goes out in Spanish; this shows the admin what it says (preview only) */}
        <PreviewEnglish key={englishText(view)} text={englishText(view)} />
      </div>
    </article>
  );
}

// ── tabs ────────────────────────────────────────────────────────────────────

// Tab bar: arrow keys / Home / End move between tabs (WAI-ARIA tabs pattern).
function TabBar({ tabs, tab, setTab, badges }) {
  const refs = useRef({});
  const ids = tabs.map(([id]) => id);
  const onKey = (e) => {
    const i = ids.indexOf(tab);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ids.length - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    const id = ids[(to + ids.length) % ids.length];
    setTab(id);
    refs.current[id]?.focus();
  };
  return (
    <div className="sticky top-0 z-20 -mx-4 px-4 sm:mx-0 sm:px-0 bg-paper">
      <div role="tablist" aria-label="Report sections" onKeyDown={onKey} className="flex gap-1 overflow-x-auto border-b" style={{ borderColor: T.borderLight }}>
        {tabs.map(([id, label]) => {
          const on = tab === id;
          const b = badges[id];
          return (
            <button
              key={id}
              ref={(el) => { refs.current[id] = el; }}
              id={`tab-${id}`}
              role="tab"
              type="button"
              aria-selected={on}
              aria-controls={`panel-${id}`}
              tabIndex={on ? 0 : -1}
              onClick={() => setTab(id)}
              className="relative shrink-0 inline-flex items-center gap-2 px-3.5 py-3 text-[13.5px] whitespace-nowrap transition-colors focus-visible:outline focus-visible:outline-2 rounded-t-md"
              style={{ color: on ? T.textPrimary : T.textSecondary, fontWeight: on ? 600 : 500 }}
            >
              {label}
              {b?.n ? (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-bold tabular-nums inline-flex items-center justify-center" style={{ background: b.tone === 'alert' ? T.danger : b.tone === 'warn' ? T.warning : T.bgSurface, color: b.tone ? '#fff' : T.textSecondary, border: b.tone ? 'none' : `1px solid ${T.borderLight}` }}>{b.n}</span>
              ) : null}
              <span aria-hidden className="absolute left-2 right-2 -bottom-px h-[2px] rounded-full" style={{ background: on ? T.primary : 'transparent' }} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── one researcher's section ────────────────────────────────────────────────

// Short bullet points (old reports: one summary paragraph).
function Points({ points, summary, big = false }) {
  const list = Array.isArray(points) && points.length ? points : summary ? [summary] : [];
  if (!list.length) return null;
  return (
    <ul className={`mt-3 space-y-1.5 max-w-[80ch] ${big ? 'text-[15px]' : 'text-[14px]'}`} style={{ color: T.textBody }}>
      {list.map((p, i) => <li key={i} className="flex gap-2.5 leading-snug"><span aria-hidden className="mt-[0.55em] w-1.5 h-1.5 rounded-full shrink-0" style={{ background: T.textMuted }} />{p}</li>)}
    </ul>
  );
}

function TrendTag({ trend }) {
  const [c, bg, label] = TREND[trend] || TREND.too_early;
  return <Tag color={c} bg={bg}>{label}</Tag>;
}

// The researcher's own briefing at the top of its tab.
function SectionHead({ sec, blurb }) {
  return (
    <section className="rounded-[14px] bg-white p-5 sm:p-6" style={{ border: `1px solid ${T.borderLight}` }}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12.5px]" style={{ color: T.textSecondary }}>{sec.title}</p>
        {sec.failed ? <Tag color={T.danger} bg={T.dangerSurface}>Did not finish</Tag> : <TrendTag trend={sec.trend} />}
      </div>
      <h2 className="mt-3 text-[20px] font-bold leading-snug max-w-[60ch]" style={{ color: T.textPrimary, letterSpacing: '-0.015em' }}>{sec.failed ? 'This researcher could not finish this week' : sec.headline}</h2>
      {sec.failed ? <p className="mt-2 text-[14px]" style={{ color: T.textBody }}>{sec.error}</p> : <Points points={sec.points} summary={sec.summary} />}
    </section>
  );
}

function ProblemsAndWins({ negatives, positives, fb, onVote }) {
  if (!negatives.length && !positives.length) return null;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Panel title="Not working" >
        {negatives.map((n, i) => {
          const [c, , label] = SEVERITY[n.severity] || SEVERITY.low;
          return (
            <Row key={i}>
              <SeverityBar severity={n.severity}>
                <div className="flex items-start justify-between gap-3">
                  <div><p className="text-[11px] font-semibold" style={{ color: c }}>{label}</p><p className="text-[14px] font-semibold leading-snug mt-0.5" style={{ color: T.textPrimary }}>{n.title}</p></div>
                  <Vote item={`negative:${n.title}`} feedback={fb} onSave={onVote} />
                </div>
                <p className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{n.detail}</p>
                <Evidence>{n.evidence}</Evidence>
              </SeverityBar>
            </Row>
          );
        })}
        {!negatives.length ? <Empty>No problems found.</Empty> : null}
      </Panel>
      <Panel title="Working" >
        {positives.map((p, i) => (
          <Row key={i}>
            <div className="pl-3.5" style={{ borderLeft: `3px solid ${T.success}` }}>
              <div className="flex items-start justify-between gap-3">
                <p className="text-[14px] font-semibold leading-snug" style={{ color: T.textPrimary }}>{p.title}</p>
                <Vote item={`positive:${p.title}`} feedback={fb} onSave={onVote} />
              </div>
              <p className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{p.detail}</p>
              <Evidence>{p.evidence}</Evidence>
            </div>
          </Row>
        ))}
        {!positives.length ? <Empty>Nothing stood out.</Empty> : null}
      </Panel>
    </div>
  );
}

// A "Draft an email" button for an item the report did not draft for.
function DraftButton({ has, busy, onClick }) {
  if (has) return <span className="text-[12px] font-medium" style={{ color: T.success }}>Draft in Emails</span>;
  return <button type="button" disabled={busy} onClick={onClick} className={btnSecondary} style={{ borderColor: T.borderLight }}>{busy ? 'Writing…' : 'Draft an email'}</button>;
}

function ClaimChecks({ items, hasDraft, compose, composing, fb, onVote }) {
  if (!items.length) return null;
  const counts = items.reduce((m, x) => ({ ...m, [x.verdict]: (m[x.verdict] || 0) + 1 }), {});
  return (
    <Panel title="Complaints checked" sub={`${Object.entries(counts).map(([k, n]) => `${n} ${CLAIM[k]?.[2].toLowerCase() || k}`).join(', ')}.`}>
      {items.map(({ x, i }) => {
        const [c, bg, label] = CLAIM[x.verdict] || CLAIM.unclear;
        return (
          <Row key={i}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Tag color={c} bg={bg}>{label}</Tag><span className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{x.who}</span></div>
                <p className="text-[13px] mt-2 italic leading-relaxed" style={{ color: T.textSecondary }}>“{x.claim}”</p>
                <div className="mt-2 rounded-[10px] p-3" style={{ background: T.bgSurface }}>
                  <p className="text-[11.5px] font-semibold" style={{ color: T.textSecondary }}>{x.verdict === 'false_flag' ? 'Why it is a false flag' : x.verdict === 'confirmed' ? 'What the records confirm' : 'What would settle it'}</p>
                  <p className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.reason}</p>
                </div>
                <Evidence>{x.evidence}</Evidence>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Vote item={`claim:${x.who}:${x.verdict}`} feedback={fb} onSave={onVote} />
                {x.verdict !== 'confirmed' ? <DraftButton has={hasDraft(x)} busy={composing === `claim:${i}`} onClick={() => compose('claim', i)} /> : null}
              </div>
            </div>
          </Row>
        );
      })}
    </Panel>
  );
}

function Suspicious({ items, title, sub, hasDraft, compose, composing, fb, onVote, filters = true }) {
  const [show, setShow] = useState('all');
  if (!items.length) return null;
  const shown = items.filter(({ x }) => show === 'all' || x.verdict === show);
  const verdicts = [...new Set(items.map(({ x }) => x.verdict))];
  return (
    <Panel title={title} sub={sub} right={filters && verdicts.length > 1 ? (
      <div role="group" aria-label="Filter" className="flex flex-wrap gap-1 p-1 rounded-full" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
        {['all', ...verdicts].map((v) => (
          <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className="text-[12px] font-medium px-3 py-1 rounded-full"
            style={{ background: show === v ? T.primary : 'transparent', color: show === v ? '#fff' : T.textSecondary }}>
            {v === 'all' ? `All ${items.length}` : `${SUSPECT[v]?.[2] || v} ${items.filter(({ x }) => x.verdict === v).length}`}
          </button>
        ))}
      </div>
    ) : null}>
      {shown.map(({ x, i }) => {
        const [c, bg, label] = SUSPECT[x.verdict] || SUSPECT.unclear;
        return (
          <Row key={i}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><Tag color={c} bg={bg}>{label}</Tag><span className="text-[11.5px]" style={{ color: T.textMuted }}>{SUSPECT_KIND[x.kind] || x.kind}</span></div>
                <p className="text-[14px] font-semibold mt-2 leading-snug" style={{ color: T.textPrimary }}>{x.title}</p>
                <p className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.reason}</p>
                {x.action ? <p className="text-[12.5px] mt-1.5" style={{ color: T.textSecondary }}><span className="font-semibold">Action:</span> {x.action}</p> : null}
              </div>
              <div className="flex flex-col items-end gap-2">
                <Vote item={`suspicious:${x.title}`} feedback={fb} onSave={onVote} />
                {x.verdict !== 'bot' && (x.user_id || x.feedback_id) ? <DraftButton has={hasDraft(x)} busy={composing === `suspicious:${i}`} onClick={() => compose('suspicious', i)} /> : null}
              </div>
            </div>
          </Row>
        );
      })}
    </Panel>
  );
}

function Followups({ items, scorecard, fb, onVote }) {
  if (!items.length && !scorecard.length) return null;
  return (
    <Panel title="Verdict per automation" sub="Last week's messages, full 7 days." flush>
      {items.length ? (
        <div className="hidden md:grid grid-cols-[230px_minmax(0,1fr)_auto] gap-x-5 px-5 py-2.5 text-[11.5px] font-semibold border-b" style={{ color: T.textSecondary, background: T.bgSurface, borderColor: T.borderLight }}>
          <span>Automation</span><span>What to do</span><span className="text-right">Your view</span>
        </div>
      ) : null}
      {items.map((f, i) => {
        const [c, bg, label] = VERDICT[f.verdict] || VERDICT.too_early;
        return (
          <div key={i} className="grid grid-cols-1 md:grid-cols-[230px_minmax(0,1fr)_auto] gap-x-5 gap-y-2 px-5 py-4" style={{ borderTop: i ? `1px solid ${T.borderLight}` : undefined }}>
            <div>
              <p className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>{automationName(f.automation)}</p>
              <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}>{channelName(f.channel)}</p>
              <div className="mt-2"><Tag color={c} bg={bg}>{label}</Tag></div>
            </div>
            <div className="min-w-0"><p className="text-[13px] leading-relaxed" style={{ color: T.textBody }}>{f.recommendation}</p><Evidence>{f.evidence}</Evidence></div>
            <Vote item={`followup:${f.automation}:${f.channel}`} feedback={fb} onSave={onVote} />
          </div>
        );
      })}
      {scorecard.length ? (
        <div className="overflow-x-auto border-t" style={{ borderColor: T.borderLight }}>
          <p className="px-5 pt-4 text-[13px] font-semibold" style={{ color: T.textPrimary }}>What people did within 7 days of each message</p>
          <table className="w-full text-[12.5px] min-w-[760px] tabular-nums mt-2">
            <thead><tr style={{ color: T.textSecondary, background: T.bgSurface }}>
              {['Automation', 'Channel', 'Sent', 'People', 'Listed', 'Paid', 'Came back', 'Read (WhatsApp)'].map((h, i) => <th key={h} scope="col" className={`py-2.5 px-3 first:pl-5 last:pr-5 font-semibold text-[11.5px] ${i >= 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {scorecard.map((s, i) => (
                <tr key={i} className="border-t" style={{ borderColor: T.borderLight, color: T.textBody }}>
                  <td className="py-2.5 px-3 pl-5"><span className="font-medium" style={{ color: T.textPrimary }}>{automationName(s.automation)}</span><span className="block text-[11px]" style={{ color: T.textMuted }}>{s.template}</span></td>
                  <td className="py-2.5 px-3">{channelName(s.channel)}</td>
                  <td className="py-2.5 px-3 text-right">{s.sent}{s.failed ? <span style={{ color: T.danger }}> ({s.failed} failed)</span> : null}</td>
                  <td className="py-2.5 px-3 text-right">{s.matched}</td>
                  <td className="py-2.5 px-3 text-right">{s.listed}{s.listedRate != null ? <span style={{ color: T.textMuted }}> · {s.listedRate}%</span> : null}</td>
                  <td className="py-2.5 px-3 text-right">{s.paid}</td>
                  <td className="py-2.5 px-3 text-right">{s.active}{s.activeRate != null ? <span style={{ color: T.textMuted }}> · {s.activeRate}%</span> : null}</td>
                  <td className="py-2.5 px-3 pr-5 text-right">{s.readRate != null ? `${s.readRate}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-5 py-3 text-[12px]" style={{ color: T.textMuted }}>No comparison group: read these as signals, not proof.</p>
        </div>
      ) : null}
    </Panel>
  );
}

function Timing({ items, rows, fb, onVote }) {
  if (!items.length && !rows.length) return null;
  return (
    <>
      {items.length ? (
        <Panel title="Send timing" >
          {items.map((x, i) => {
            const [c, bg] = CONFIDENCE[x.confidence] || CONFIDENCE.low;
            return (
              <Row key={i}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>{automationName(x.automation)}</span>
                      <span className="text-[12px]" style={{ color: T.textSecondary }}>{channelName(x.channel)}</span>
                      <Tag color={c} bg={bg}>{x.confidence} confidence</Tag>
                    </div>
                    <dl className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-3">
                      <div className="rounded-[10px] p-3" style={{ background: T.bgSurface }}><dt className="text-[11.5px] font-semibold" style={{ color: T.textSecondary }}>Now</dt><dd className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.current}</dd></div>
                      <div className="rounded-[10px] p-3" style={{ background: T.bgSurface }}><dt className="text-[11.5px] font-semibold" style={{ color: T.textSecondary }}>The numbers</dt><dd className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.numbers}</dd></div>
                      <div className="rounded-[10px] p-3" style={{ background: T.bgSurface }}><dt className="text-[11.5px] font-semibold" style={{ color: T.textSecondary }}>Change</dt><dd className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.recommendation}</dd></div>
                    </dl>
                    <p className="text-[13px] mt-2 leading-relaxed" style={{ color: T.textBody }}>{x.finding}</p>
                  </div>
                  <Vote item={`timing:${x.automation}:${x.channel}`} feedback={fb} onSave={onVote} />
                </div>
              </Row>
            );
          })}
        </Panel>
      ) : null}
      {rows.length ? (
        <Panel title="Results, last 30 days" sub="Acted = published or paid within 7 days." flush>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px] min-w-[860px] tabular-nums">
              <thead><tr style={{ color: T.textSecondary, background: T.bgSurface }}>
                {['Automation', 'Channel', 'Sent', 'Bounced', 'Opened', 'Clicked / read', 'Best send hours', 'Acted', 'Fastest action'].map((h, i) => <th key={h} scope="col" className={`py-2.5 px-3 first:pl-5 last:pr-5 font-semibold text-[11.5px] ${i >= 2 && i <= 5 || i === 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => {
                  const best = [...(r.bySendHourLocal || [])].filter((h) => h.sent >= 3).sort((a, b) => (b.rate || 0) - (a.rate || 0))[0];
                  const fastest = Object.keys(r.actedAfter || {})[0];
                  return (
                    <tr key={i} className="border-t" style={{ borderColor: T.borderLight, color: T.textBody }}>
                      <td className="py-2.5 px-3 pl-5 font-medium" style={{ color: T.textPrimary }}>{automationName(r.automation)}</td>
                      <td className="py-2.5 px-3">{channelName(r.channel)}</td>
                      <td className="py-2.5 px-3 text-right">{r.sent}{r.failed ? <span style={{ color: T.danger }}> ({r.failed} failed)</span> : null}</td>
                      <td className="py-2.5 px-3 text-right">{r.channel === 'email' ? rate(r.bounceRate) : '—'}</td>
                      <td className="py-2.5 px-3 text-right">{r.channel === 'email' ? rate(r.openRate) : '—'}</td>
                      <td className="py-2.5 px-3 text-right">{r.channel === 'email' ? rate(r.clickRate) : rate(r.readRate)}</td>
                      <td className="py-2.5 px-3">{best ? `${best.hours} h (${rate(best.rate)})` : '—'}</td>
                      <td className="py-2.5 px-3 text-right">{r.actedWithin7Days}</td>
                      <td className="py-2.5 px-3 pr-5">{fastest || '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}
    </>
  );
}

function NextSteps({ recs, title = 'Next steps', sub, fb, onVote, owner, setOwner, showSection = false }) {
  const shown = recs.filter((x) => owner === 'Everyone' || x.owner === owner);
  return (
    <Panel title={title} sub={sub} right={setOwner ? <OwnerFilter owner={owner} setOwner={setOwner} /> : null}>
      <ol>
        {shown.map((x) => (
          <li key={`${x.section}-${x.rank}`} className="py-5 border-t first:border-t-0 grid grid-cols-[32px_minmax(0,1fr)] gap-x-3" style={{ borderColor: T.borderLight }}>
            <span className="text-[20px] font-bold tabular-nums leading-none pt-0.5" style={{ color: T.textMuted }}>{x.rank}</span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <p className="text-[15px] font-semibold leading-snug" style={{ color: T.textPrimary }}>{x.title}</p>
                <Vote item={`rec:${x.title}`} feedback={fb} onSave={onVote} />
              </div>
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <OwnerTag owner={x.owner} />{ROLE[x.owner] ? <span className="text-[11.5px]" style={{ color: T.textMuted }}>{ROLE[x.owner]}</span> : null}
                <ImpactTags x={x} />
                {showSection && x.section ? <Tag color={T.textSecondary} bg={T.bgSurface}>{(RESEARCH.find(([id]) => id === x.section) || [, x.section])[1]}</Tag> : null}
              </div>
              <dl className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="rounded-[10px] p-3" style={{ background: T.bgSurface }}><dt className="text-[11.5px] font-semibold" style={{ color: T.textSecondary }}>Why</dt><dd className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.why}</dd></div>
                <div className="rounded-[10px] p-3" style={{ background: T.bgSurface }}><dt className="text-[11.5px] font-semibold" style={{ color: T.textSecondary }}>How</dt><dd className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.how}</dd></div>
              </dl>
            </div>
          </li>
        ))}
      </ol>
      {!shown.length ? <Empty>{owner === 'Everyone' ? 'No next steps.' : `Nothing for ${owner}.`}</Empty> : null}
    </Panel>
  );
}

function TasksAndIssues({ tasks, issues, fb, onVote }) {
  if (!tasks.length && !issues.length) return null;
  const groups = OWNERS.map((o) => [o, tasks.filter((t) => t.owner === o)]).filter(([, l]) => l.length);
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Panel title="Tasks" >
        {groups.map(([o, list]) => (
          <div key={o} className="py-3 border-t first:border-t-0" style={{ borderColor: T.borderLight }}>
            <p className="flex items-center gap-2 mt-1"><OwnerTag owner={o} /><span className="text-[11.5px]" style={{ color: T.textMuted }}>{ROLE[o]} · {list.length}</span></p>
            <ul className="mt-1">
              {list.map((t, i) => (
                <li key={i} className="py-2.5 pl-7">
                  <div className="flex items-start justify-between gap-3"><p className="text-[14px] font-medium leading-snug" style={{ color: T.textPrimary }}>{t.task}</p><Vote item={`task:${t.task}`} feedback={fb} onSave={onVote} /></div>
                  {t.why ? <p className="text-[12.5px] mt-1 leading-relaxed" style={{ color: T.textSecondary }}>{t.why}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ))}
        {!groups.length ? <Empty>No tasks.</Empty> : null}
      </Panel>
      <Panel title="Data and tracking issues" >
        {issues.map((x, i) => (
          <Row key={i}>
            <div className="flex items-start justify-between gap-3"><p className="text-[14px] font-medium leading-snug" style={{ color: T.textPrimary }}>{x.title}</p><Vote item={`data:${x.title}`} feedback={fb} onSave={onVote} /></div>
            <p className="text-[13px] mt-1 leading-relaxed" style={{ color: T.textBody }}>{x.detail}</p>
          </Row>
        ))}
        {!issues.length ? <Empty>No data issues.</Empty> : null}
      </Panel>
    </div>
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
  const [owner, setOwner] = useState('Everyone');
  const [emailTab, setEmailTab] = useState('draft');
  const [tab, setTabState] = useState('overview');

  // the open tab lives in the URL hash (#feedback), so links and reloads keep it
  useEffect(() => {
    const read = () => { const h = window.location.hash.slice(1); if (h) setTabState(h); };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, []);
  const setTab = useCallback((id) => {
    setTabState(id);
    window.history.replaceState(null, '', `#${id}`);
    window.scrollTo({ top: Math.min(window.scrollY, document.getElementById('report-tabs')?.offsetTop ?? 0), behavior: 'smooth' });
  }, []);

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
  const onVote = async (item, vote, note) => {
    const { ok, j } = await patch({ op: 'feedback', item, vote, note });
    if (ok) setRow((r) => ({ ...r, feedback: j.feedback }));
  };
  const onAct = async (op, a, fields = {}) => {
    setBusy(true); setMsg('');
    const { ok, j } = await patch({ op, actionId: a.id, ...fields });
    setBusy(false);
    if (!ok) { setMsg(j.errors ? Object.values(j.errors).join(' ') : (j.error || 'That did not work. Try again.')); return false; }
    setRow((r) => ({ ...r, actions: r.actions.map((x) => (x.id === a.id ? j.action : x)) }));
    if (op === 'send') setMsg(`Email sent to ${j.action.sent_to}.`);
    if (op === 'dismiss') setMsg('Draft dismissed. You can move it back from the Dismissed tab.');
    return true;
  };
  // "Draft an email" on a checked item → a new draft in Emails
  const compose = async (source, index) => {
    setComposing(`${source}:${index}`); setMsg('');
    const { ok, j } = await patch({ op: 'compose', source, index });
    setComposing(null);
    if (!ok) { setMsg(j.message || j.error || 'The draft could not be written. Try again.'); return; }
    setRow((r) => ({ ...r, actions: [...(r.actions || []), j.action] }));
    setMsg(j.via === 'claude' ? 'Draft written. It is waiting in Emails: read it, edit if needed, then approve.' : 'Claude could not be reached, so a blank starter was added in Emails: write the message there.');
  };

  const r = row?.report || {};
  const pack = row?.data_pack || {};
  const fb = row?.feedback || {};
  const actions = useMemo(() => row?.actions || [], [row?.actions]);
  const counts = useMemo(() => ({
    draft: actions.filter((a) => a.status === 'draft').length,
    sent: actions.filter((a) => a.status === 'sent').length,
    dismissed: actions.filter((a) => a.status === 'dismissed').length,
  }), [actions]);
  const [countryName, tld] = COUNTRY[row?.country] || [String(row?.country || '').toUpperCase(), '.py'];

  if (err) {
    return (
      <div className="space-y-4">
        <Link href="/manager" className="text-[13px] underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>← All reports</Link>
        <Banner>{err === 'not_found' ? 'This report does not exist in the selected country. Switch country in the header or go back to all reports.' : err}</Banner>
      </div>
    );
  }
  if (!row) return <p className="text-[13px]" style={{ color: T.textMuted }}>Loading the report…</p>;

  const sections = r.sections || [];
  const bySection = (list, id) => (list || []).map((x, i) => ({ x, i })).filter(({ x }) => x.section === id);
  const plain = (list, id) => bySection(list, id).map(({ x }) => x);
  const sortSev = (list) => [...list].sort((a, b) => SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity));
  const hasDraft = (x) => actions.some((a) => (x.user_id && a.user_id === x.user_id) || (x.feedback_id && String(a.feedback_id) === String(x.feedback_id)));
  const priorities = (r.recommendations || []).map((x, i) => ({ ...x, rank: i + 1 }));
  const allNeg = r.negatives || [];
  const highCount = allNeg.filter((n) => n.severity === 'high').length;
  const falseFlags = (r.claim_checks || []).filter((c) => c.verdict === 'false_flag').length;
  const bots = (r.suspicious || []).filter((c) => c.verdict === 'bot').length;

  const tabs = [['overview', 'Overview'], ...RESEARCH.filter(([id]) => sections.some((s) => s.id === id)).map(([id, label]) => [id, label]), ['emails', 'Emails'], ['method', 'How it was made']];
  const badges = { emails: { n: counts.draft, tone: counts.draft ? 'warn' : null } };
  for (const s of sections) {
    const neg = allNeg.filter((n) => n.section === s.id);
    badges[s.id] = { n: neg.length, tone: neg.some((n) => n.severity === 'high') ? 'alert' : null };
  }
  const panel = (id) => ({ id: `panel-${id}`, role: 'tabpanel', 'aria-labelledby': `tab-${id}`, hidden: tab !== id, className: 'space-y-5 pt-6' });
  const shared = { fb, onVote, hasDraft, compose, composing };

  return (
    <div className="pb-16">
      <Link href="/manager" className="text-[13px] underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>← All reports</Link>

      {/* ── briefing header (the lead) ── */}
      <header className="mt-4 rounded-[18px] p-6 sm:p-8" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px]" style={{ color: T.textSecondary }}>
            Weekly report for {countryName}, {weekRange(row.period_start || row.created_at, row.period_end || row.created_at)}{sections.length ? `, by ${sections.length} researchers and a lead` : ''}
          </p>
          <div className="flex items-center gap-2 text-[12px]" style={{ color: T.textMuted }}>
            {row.status === 'done' ? <Tag color={T.success} bg={T.successSurface}>Ready</Tag> : row.status === 'running' ? <Tag color={T.info} bg={T.infoSurface}>Being written</Tag> : <Tag color={T.danger} bg={T.dangerSurface}>Failed</Tag>}
            <span>{row.trigger === 'cron' ? 'Weekly run' : 'Run by hand'}{row.cost_usd != null ? `, US$${Number(row.cost_usd).toFixed(2)}` : ''}</span>
          </div>
        </div>
        <h1 className="mt-4 text-[26px] sm:text-[30px] font-bold leading-[1.15] max-w-[34ch]" style={{ color: T.textPrimary, letterSpacing: '-0.025em' }}>
          {r.headline || (row.status === 'running' ? 'The researchers are reading this week’s numbers…' : 'This report could not be written')}
        </h1>
        <Points points={r.points} summary={r.summary} big />
        {row.status === 'done' ? (
          <div className="mt-6 flex flex-wrap gap-2">
            {counts.draft ? <button type="button" onClick={() => { setEmailTab('draft'); setTab('emails'); }} className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: T.primary, color: '#fff' }}>{plural(counts.draft, 'email')} waiting for your review</button> : null}
            {highCount ? <span className="inline-flex items-center rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: T.dangerSurface, color: T.danger }}>{plural(highCount, 'high-priority problem')}</span> : null}
            {falseFlags ? <button type="button" onClick={() => setTab('feedback')} className="inline-flex items-center rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: T.infoSurface, color: T.info }}>{plural(falseFlags, 'false flag')} caught</button> : null}
            {bots ? <button type="button" onClick={() => setTab('feedback')} className="inline-flex items-center rounded-full px-4 py-2 text-[13px] font-semibold" style={{ background: T.bgSurface, color: T.textBody, border: `1px solid ${T.borderLight}` }}>{plural(bots, 'bot')} filtered out</button> : null}
          </div>
        ) : null}
      </header>

      {row.status !== 'done' ? (
        <div className="mt-6">
          <Panel title={row.status === 'running' ? 'The researchers are working' : 'What went wrong'} sub={row.status === 'running' ? 'Five researchers work in parallel, then the lead combines them. This takes a few minutes; you can leave this page.' : row.error}>
            <ol className="space-y-2 border-l pl-4 my-4" style={{ borderColor: T.borderLight }}>
              {(row.log || []).map((l, i) => <li key={i} className="text-[13px] leading-relaxed" style={{ color: T.textBody }}><span className="tabular-nums mr-2" style={{ color: T.textMuted }}>{when(l.at)}</span>{l.text}</li>)}
            </ol>
          </Panel>
        </div>
      ) : (
        <div id="report-tabs" className="mt-6 scroll-mt-2">
          <TabBar tabs={tabs} tab={tab} setTab={setTab} badges={badges} />
          {msg ? <div className="pt-5"><Banner tone="warning">{msg}</Banner></div> : null}

          {/* ── Overview (the lead) ── */}
          <div {...panel('overview')}>
            <Panel title="Key numbers" sub="vs last week. No team, test or bot accounts." flush>
              {Array.isArray(pack.kpis) ? (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-px rounded-b-[14px] overflow-hidden" style={{ background: T.borderLight }}>
                  {pack.kpis.map((k) => {
                    const up = k.changePct > 0, down = k.changePct < 0;
                    return (
                      <div key={k.label} className="p-4 sm:p-5 bg-white">
                        <p className="text-[12px]" style={{ color: T.textSecondary }}>{k.label}</p>
                        <p className="text-[24px] font-bold tabular-nums mt-1" style={{ color: T.textPrimary, letterSpacing: '-0.02em' }}>{fmtNum(k.value, k.unit)}</p>
                        <p className="text-[12px] mt-0.5 tabular-nums" style={{ color: up ? T.success : down ? T.danger : T.textMuted }}>
                          {k.changePct == null ? (k.previous == null ? 'No earlier number' : `Was ${fmtNum(k.previous, k.unit)}`) : `${up ? '▲' : down ? '▼' : '='} ${Math.abs(k.changePct)}%, was ${fmtNum(k.previous, k.unit)}`}
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : <div className="px-5"><Empty>No numbers were saved with this report.</Empty></div>}
            </Panel>

            {sections.length ? (
              <Panel title="Researchers"  flush>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-px rounded-b-[14px] overflow-hidden" style={{ background: T.borderLight }}>
                  {RESEARCH.filter(([id]) => sections.some((s) => s.id === id)).map(([id, label, blurb]) => {
                    const s = sections.find((x) => x.id === id);
                    const neg = allNeg.filter((n) => n.section === id);
                    const drafts = actions.filter((a) => a.section === id && a.status === 'draft').length;
                    return (
                      <button key={id} type="button" onClick={() => setTab(id)} className="text-left p-5 bg-white hover:bg-[#FAF7F1] transition-colors focus-visible:outline focus-visible:outline-2">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>{label}</p>
                          {s.failed ? <Tag color={T.danger} bg={T.dangerSurface}>Did not finish</Tag> : <TrendTag trend={s.trend} />}
                        </div>
                        <p className="text-[11.5px] mt-0.5" style={{ color: T.textMuted }}>{blurb}</p>
                        <p className="text-[13px] mt-3 leading-relaxed line-clamp-3" style={{ color: T.textBody }}>{s.failed ? s.error : s.headline}</p>
                        <p className="text-[12px] mt-3 tabular-nums" style={{ color: T.textSecondary }}>
                          {plural(neg.length, 'problem')}{neg.some((n) => n.severity === 'high') ? ` (${neg.filter((n) => n.severity === 'high').length} high)` : ''}{drafts ? `, ${plural(drafts, 'draft')}` : ''}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </Panel>
            ) : null}

            {counts.draft ? (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-[14px] px-5 py-4" style={{ background: T.warningSurface, border: `1px solid ${T.borderLight}` }}>
                <p className="text-[14px]" style={{ color: T.textBody }}><span className="font-semibold" style={{ color: T.textPrimary }}>{plural(counts.draft, 'personal email')}</span> {counts.draft === 1 ? 'is' : 'are'} drafted and waiting for your review. Nothing is sent until you approve it.</p>
                <button type="button" className={btnPrimary} onClick={() => { setEmailTab('draft'); setTab('emails'); }}>Review emails</button>
              </div>
            ) : null}

            <NextSteps recs={priorities} title="Priorities"  fb={fb} onVote={onVote} owner={owner} setOwner={setOwner} showSection />
          </div>

          {/* ── one tab per researcher ── */}
          {RESEARCH.map(([id, , blurb]) => {
            const sec = sections.find((s) => s.id === id);
            if (!sec) return null;
            const recs = plain(r.section_recommendations, id).map((x, i) => ({ ...x, rank: i + 1 }));
            return (
              <div key={id} {...panel(id)}>
                <SectionHead sec={sec} blurb={blurb} />
                {id === 'feedback' ? (
                  <>
                    <ClaimChecks items={bySection(r.claim_checks, id)} {...shared} />
                    <Suspicious items={bySection(r.suspicious, id)} title="Bots" sub="Not counted, never emailed." {...shared} />
                  </>
                ) : null}
                {id === 'listings' ? (
                  <Suspicious items={bySection(r.suspicious, id)} title="Listings with wrong data"  {...shared} />
                ) : null}
                <ProblemsAndWins negatives={sortSev(plain(r.negatives, id))} positives={plain(r.positives, id)} fb={fb} onVote={onVote} />
                {id === 'followups' ? (
                  <>
                    <Followups items={plain(r.followups, id)} scorecard={pack.automations?.followUpsPreviousWeekFullResults || []} fb={fb} onVote={onVote} />
                    <Timing items={plain(r.timing, id)} rows={pack.messageTiming?.rows || []} fb={fb} onVote={onVote} />
                  </>
                ) : null}
                {recs.length ? <NextSteps recs={recs}  fb={fb} onVote={onVote} owner="Everyone" /> : null}
                <TasksAndIssues tasks={plain(r.team_tasks, id)} issues={plain(r.data_issues, id)} fb={fb} onVote={onVote} />
              </div>
            );
          })}

          {/* ── Emails ── */}
          <div {...panel('emails')}>
            <Panel
              title="Emails to send"
              sub="Nothing is sent until you approve it."
              right={(
                <div role="group" aria-label="Email status" className="flex gap-1 p-1 rounded-full" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
                  {[['draft', 'To review'], ['sent', 'Sent'], ['dismissed', 'Dismissed']].map(([k, l]) => (
                    <button key={k} type="button" aria-pressed={emailTab === k} onClick={() => setEmailTab(k)} className="text-[12px] font-medium px-3 py-1 rounded-full tabular-nums"
                      style={{ background: emailTab === k ? T.primary : 'transparent', color: emailTab === k ? '#fff' : T.textSecondary }}>{l} {counts[k]}</button>
                  ))}
                </div>
              )}
            >
              {!actions.filter((a) => a.status === emailTab).length ? (
                <Empty>{emailTab === 'draft' ? (actions.length ? 'All drafts are handled.' : 'No one needs a personal email this week.') : emailTab === 'sent' ? 'Nothing sent yet.' : 'Nothing dismissed.'}</Empty>
              ) : <div className="h-1" />}
            </Panel>
            {actions.filter((a) => a.status === emailTab).map((a) => <Draft key={a.id} a={a} busy={busy} onAct={onAct} site={site} tld={tld} />)}
          </div>

          {/* ── How it was made ── */}
          <div {...panel('method')}>
            <Panel title="How this report was made" sub="5 read-only researchers + a lead." flush>
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-px overflow-hidden" style={{ background: T.borderLight }}>
                {[['Model', row.model || '—'], ['Steps', row.usage?.calls ?? '—'], ['Cost', row.cost_usd != null ? `US$${Number(row.cost_usd).toFixed(2)}` : '—'], ['Finished', when(row.finished_at)]].map(([k, v]) => (
                  <div key={k} className="p-4 bg-white"><dt className="text-[12px]" style={{ color: T.textSecondary }}>{k}</dt><dd className="text-[14px] font-semibold mt-0.5 tabular-nums" style={{ color: T.textPrimary }}>{v}</dd></div>
                ))}
              </dl>
              {row.notes ? (
                <details className="border-t" style={{ borderColor: T.borderLight }}>
                  <summary className="cursor-pointer px-5 py-3.5 text-[13px] font-semibold" style={{ color: T.textPrimary }}>The researchers’ working notes</summary>
                  <p className="px-5 pb-5 text-[13px] leading-relaxed whitespace-pre-wrap max-w-[80ch]" style={{ color: T.textBody }}>{row.notes}</p>
                </details>
              ) : null}
              <details className="border-t" style={{ borderColor: T.borderLight }}>
                <summary className="cursor-pointer px-5 py-3.5 text-[13px] font-semibold" style={{ color: T.textPrimary }}>Run log</summary>
                <ol className="px-5 pb-5 space-y-1.5">
                  {(row.log || []).map((l, i) => <li key={i} className="text-[12px] leading-relaxed" style={{ color: T.textBody }}><span className="tabular-nums mr-2" style={{ color: T.textMuted }}>{when(l.at)}</span>{l.text}</li>)}
                </ol>
              </details>
              <details className="border-t" style={{ borderColor: T.borderLight }}>
                <summary className="cursor-pointer px-5 py-3.5 text-[13px] font-semibold" style={{ color: T.textPrimary }}>All numbers they were given</summary>
                <pre className="mx-5 mb-5 text-[11px] p-4 rounded-lg overflow-auto max-h-[480px]" style={{ background: T.bgSurface, color: T.textBody }}>{JSON.stringify(pack, null, 2)}</pre>
              </details>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}
