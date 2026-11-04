'use client';
// Admin Manager → "Open issues today": the daily check, written like Roland's Claude audit — one
// short summary, then each issue as: who · what happened (one line) · how to resolve it. The
// evidence, the ready message and the buttons open under "Details". Nothing is sent or given
// away until someone clicks. Data + actions: /api/issues (lib/openIssues*.js).
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { T, CARD, Banner, fmtDate, btnPrimary, btnSecondary } from '@/components/automations/ui';
import { useDialog } from '@/components/Dialog';

const GROUP_OF = { unanswered: 'Messages', keyword: 'Messages', followup: 'Follow-ups', payment: 'Payments', views: 'Listings', funnel: 'Funnels', security: 'Security' };
const ORDER = ['Messages', 'Follow-ups', 'Payments', 'Listings', 'Funnels', 'Security', 'Results'];
const DOT = { urgent: '#B23A2B', high: '#A86A00', medium: '#1F5E9C', low: '#9a8f84', achieved: '#0F6E56' };
const HANDLED = { achieved: 'Goal reached', done: 'Done', dismissed: 'Dismissed', sent: 'Message sent', gift: 'Published free', kept: 'Kept suspended', lifted: 'Suspension lifted' };
const LABEL = {
  publish_free: 'Publish free (gift)', send_whatsapp: 'Send on WhatsApp', send_email: 'Send by email', write_ai: 'Write with AI',
  keep_suspended: 'Keep suspended', lift_suspension: 'Lift suspension', done: 'Mark done', dismiss: 'Dismiss',
};
const ago = (iso) => {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return ms < 3600000 ? `${Math.max(1, Math.round(ms / 60000))} min` : ms < 86400000 ? `${Math.round(ms / 3600000)} h` : `${Math.round(ms / 86400000)} days`;
};
// the one line under the title: what they said + the one fact that matters
function whatLine(i) {
  const ev = i.evidence || [];
  const said = ev.find((e) => e.startsWith('“') || e.startsWith('They wrote: “') || e.startsWith('They asked: “'));
  const quote = said ? `${said.startsWith('They asked') ? 'Asked' : 'Wrote'} ${said.replace(/^They (wrote|asked): /, '')}` : null;
  // the one fact that matters: our answer and its result first (payments), then the rest
  const key = ev.find((e) => /^Read: /.test(e)) || ev.find((e) => /answered .* ago|Nobody answered/i.test(e))
    || ev.find((e) => /window open|Why a person|waiting|no buyer|reminders|No successful|IP |blocked region|views/i.test(e) && e !== said);
  const short = (x, n) => (x && x.length > n ? `${x.slice(0, n - 1).trim()}…` : x);
  const q = quote && quote.length > 110 ? `${quote.slice(0, 108).trim()}…”` : quote;
  return [q, key && short(key.replace(/^Why a person: /, ''), 110)].filter(Boolean).join(' · ') || short(ev[0] || '', 140);
}

// "Was it handled? Did it work? Will more go out?" — from the person's message and send history
// (lib/openIssuesHandling.js)
function Track({ t }) {
  const lbl = (x) => <span className="font-semibold" style={{ color: T.textPrimary }}>{x}</span>;
  const last = t.items?.[0];
  return (
    <div className="mt-1 space-y-0.5 text-[12.5px] leading-snug" style={{ color: T.textSecondary }} data-testid="issue-track">
      <p>{lbl('Handled:')} {t.handled ? `Yes — by ${t.by.join(', ')}${last ? ` (${t.items.length}×, last ${ago(last.at)} ago)` : ''}` : 'Not yet — nothing was sent about this.'}</p>
      <p>{lbl('Our goal:')} {t.goal?.text} — {t.goal?.reached ? <span style={{ color: T.success }}>reached</span> : 'not reached yet'}</p>
      <p>{lbl('Reminders:')} {t.reminders}</p>
      {t.their?.length > 0 && <p>{lbl('They:')} {t.their.map((x) => `${x.what} (${ago(x.at)} ago)`).join(' · ')}</p>}
    </div>
  );
}
const shortDate = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : ''; };

function Issue({ issue, onAction, busy, mode }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(issue.draft?.en || '');   // the team writes in English
  const [msg, setMsg] = useState(null);
  const p = issue.person || {};
  const digits = String(p.phone || '').replace(/\D/g, '');
  const live = issue.status === 'open';
  const achieved = issue.status === 'achieved';
  const act = async (action) => {
    setMsg(null);
    const r = await onAction(issue, action, { text });
    if (r?.text) setText(r.text);
    if (r?.message) setMsg(r.message);
  };
  const primary = issue.actions.find((a) => !['open_chat', 'done', 'dismiss', 'write_ai'].includes(a));
  return (
    <li className="py-3 border-t first:border-t-0" style={{ borderColor: T.borderLight, opacity: live || achieved ? 1 : 0.6 }} data-testid="issue" data-issue-id={issue.id}>
      <div className="flex gap-3">
        <span className="mt-[7px] w-2 h-2 rounded-full shrink-0" style={{ background: achieved ? DOT.achieved : DOT[issue.priority] || DOT.low }} title={achieved ? 'goal reached' : issue.priority} />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] leading-snug" style={{ color: T.textPrimary }}>
            <b>{issue.title}</b>{!live && !achieved && <span className="ml-2 text-[12px] font-medium" style={{ color: T.success }}>{HANDLED[issue.status] || issue.status}{issue.handled?.by ? ` by ${issue.handled.by}` : ''}</span>}
          </p>
          <p className="text-[13px] leading-snug mt-0.5" style={{ color: T.textSecondary }}>{whatLine(issue)}</p>
          {issue.track && <Track t={issue.track} />}
          {!achieved && <p className="text-[13px] leading-snug mt-0.5" style={{ color: T.textPrimary }}><span className="font-semibold">Fix:</span> {issue.suggestion}</p>}
          {live && (
            <div className="flex flex-wrap items-center gap-2 mt-2">
              {primary && <button type="button" className={btnSecondary} disabled={!!busy} onClick={() => (primary.startsWith('send_') && !open ? setOpen(true) : act(primary))} style={{ borderColor: 'rgba(17,17,17,.25)', color: T.textPrimary }} data-testid={`issue-${primary}`}>{busy === primary ? 'Working…' : LABEL[primary] || primary}</button>}
              {issue.actions.includes('open_chat') && digits && <Link href={`/inbox?phone=${digits}${mode === 'test' ? '&mode=test' : ''}`} className="text-[12.5px] font-medium underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>Open chat</Link>}
              <button type="button" onClick={() => setOpen((v) => !v)} className="text-[12.5px] font-medium underline-offset-2 hover:underline" style={{ color: T.textSecondary }} data-testid="issue-details">{open ? 'Hide details' : 'Details'}</button>
              <span className="flex-1" />
              {['done', 'dismiss'].filter((a) => issue.actions.includes(a)).map((a) => (
                <button key={a} type="button" disabled={!!busy} onClick={() => act(a)} className="text-[12px] px-1.5 py-0.5 rounded hover:bg-ink/5" style={{ color: T.textMuted }} data-testid={`issue-${a}`}>{LABEL[a]}</button>
              ))}
            </div>
          )}
          {msg && <p className="text-[12.5px] mt-1.5" style={{ color: msg.startsWith('✓') ? T.success : T.danger }}>{msg}</p>}
          {open && live && (
            <div className="mt-2.5 pl-3 border-l-2 space-y-2" style={{ borderColor: T.borderLight }}>
              <ul className="space-y-0.5">{issue.evidence.map((e, k) => <li key={k} className="text-[12.5px] leading-snug" style={{ color: T.textSecondary }}>{e}</li>)}</ul>
              {issue.track?.items?.length > 0 && (
                <div>
                  <p className="text-[12px] font-semibold" style={{ color: T.textPrimary }}>What we already did</p>
                  <ul className="space-y-0.5">{issue.track.items.map((x, k) => <li key={k} className="text-[12.5px] leading-snug" style={{ color: T.textSecondary }}>{shortDate(x.at)} · <b className="font-medium">{x.by}</b>: {x.what}{x.status ? ` · ${x.status}` : ''}</li>)}</ul>
                </div>
              )}
              <p className="text-[12px]" style={{ color: T.textMuted }}>{[p.name, p.phone, p.email].filter(Boolean).join(' · ')} · since {ago(issue.since)}</p>
              {(issue.draft || issue.actions.some((a) => a.startsWith('send_'))) && (
                <>
                  <textarea value={text} onChange={(e) => setText(e.target.value)} rows={Math.min(7, Math.max(3, Math.ceil(text.length / 95)))} aria-label="Message" data-testid="issue-draft"
                    placeholder={issue.actions.includes('write_ai') ? 'Write the reply, or “Write with AI”.' : 'Write the message.'}
                    className="w-full px-3 py-2 rounded-[10px] border text-[13px] leading-relaxed outline-none focus:border-ink/60" style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary }} />
                  <p className="text-[11.5px] leading-snug" style={{ color: T.textMuted }}>Write in English — it is sent in their language (Spanish for Paraguay), translated automatically.</p>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                {issue.actions.filter((a) => !['open_chat', 'done', 'dismiss'].includes(a)).map((a) => (
                  <button key={a} type="button" disabled={!!busy} onClick={() => act(a)} className={a === primary ? btnPrimary : btnSecondary} style={a === primary ? {} : { borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary }} data-testid={`issue-full-${a}`}>
                    {busy === a ? 'Working…' : LABEL[a] || a}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

// the opening paragraph, like Roland's audit: how many, the most urgent by name, by area
function summary(open, achievedN = 0) {
  if (!open.length) return `Nobody is waiting on us: every person who wrote got an answer, and nothing is pending.${achievedN ? ` ${achievedN} ${achievedN === 1 ? 'person' : 'people'} did what the assistant suggested.` : ''}`;
  const urgent = open.filter((i) => i.priority === 'urgent');
  const by = ORDER.map((g) => [g, open.filter((i) => GROUP_OF[i.type] === g).length]).filter(([, n]) => n);
  const top = open.slice(0, 3).map((i) => i.person?.name || 'someone');
  return `${open.length} open${urgent.length ? `, ${urgent.length} urgent (the WhatsApp window is still open)` : ''}: ${by.map(([g, n]) => `${g.toLowerCase()} ${n}`).join(', ')}. Start with ${top.join(', ')}.${achievedN ? ` ${achievedN} ${achievedN === 1 ? 'person' : 'people'} did what the assistant suggested.` : ''}`;
}

export default function OpenIssues({ day = null }) {
  const { dialog, confirm, prompt } = useDialog();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showHandled, setShowHandled] = useState(false);
  const [busy, setBusy] = useState({});

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ ...(day ? { day } : {}), ...(fresh ? { fresh: '1' } : {}) });
      const r = await fetch(`/api/issues?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error || `HTTP ${r.status}`);
      setData(j); setErr('');
    } catch (e) { setErr(String(e.message || e)); }
    setLoading(false);
  }, [day]);
  useEffect(() => { load(); }, [load]);

  const onAction = async (issue, action, { text }) => {
    if (action === 'write_ai') {
      setBusy((b) => ({ ...b, [issue.id]: action }));
      try {
        const r = await fetch('/api/inbox/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: issue.person.phone }) });
        const j = await r.json();
        if (!r.ok || j.error) return { message: j.error || 'The AI could not write it.' };
        return { text: j.english || j.message, message: '✓ Written — check it before sending.' };
      } finally { setBusy((b) => ({ ...b, [issue.id]: null })); }
    }
    let note = '';
    if (action === 'publish_free') {
      const n = issue.data?.propertyIds?.length || 0;
      if (!(await confirm({ title: `Publish ${n === 1 ? 'this listing' : `these ${n} listings`} for free?`, message: `${issue.person.name}'s ${n === 1 ? 'listing goes' : 'listings go'} live as a gift after the usual photo check. Then send the thank-you.`, confirmLabel: 'Publish free' }))) return null;
    } else if (action === 'lift_suspension') {
      if (!(await confirm({ title: 'Lift the suspension?', message: `${issue.person.name} can sign in again.`, confirmLabel: 'Lift' }))) return null;
    } else if (action === 'send_whatsapp' || action === 'send_email') {
      if (!text.trim()) return { message: 'Write the message first (Details).' };
      if (!(await confirm({ title: action === 'send_whatsapp' ? `Send on WhatsApp to ${issue.person.name}?` : `Email ${issue.person.email}?`, message: text, confirmLabel: 'Send' }))) return null;
    } else if (action === 'done' || action === 'dismiss') {
      const v = await prompt({ title: action === 'done' ? 'Mark done' : 'Dismiss', message: 'A short note for the team (optional).', confirmLabel: action === 'done' ? 'Mark done' : 'Dismiss' });
      if (v === null) return null;
      note = v || '';
    }
    setBusy((b) => ({ ...b, [issue.id]: action }));
    try {
      const r = await fetch('/api/issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: issue.id, action, text, note, lang: 'en' }) });
      const j = await r.json();
      if (!r.ok || !j.ok) return { message: j.error || 'Failed.' };
      await load(!!data?.isToday);
      if (action === 'publish_free') return { message: `✓ Published free. ${j.scanStarted ? 'The photo check started.' : 'Live after the photo check (within the hour).'} Now send the thank-you.` };
      if (j.redirectedTo) return { message: `✓ Sent (in their language) — locally redirected to ${j.redirectedTo}.` };
      if (j.sentText) return { message: '✓ Sent, translated into their language.' };
      return { message: '✓ Done.' };
    } finally { setBusy((b) => ({ ...b, [issue.id]: null })); }
  };

  const issues = data?.issues || [];
  const open = issues.filter((i) => i.status === 'open');
  const groupOf = (i) => (i.status === 'achieved' ? 'Results' : GROUP_OF[i.type]);
  const groups = useMemo(() => ORDER.map((g) => [g, issues.filter((i) => groupOf(i) === g && (showHandled || i.status === 'open' || i.status === 'achieved'))]).filter(([, l]) => l.length), [issues, showHandled]);

  return (
    <section className="bg-white overflow-hidden" style={CARD} data-testid="manager-open-issues">
      {dialog}
      <div className="px-5 pt-4 pb-3 flex flex-wrap items-start justify-between gap-2 border-b" style={{ borderColor: T.borderLight }}>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold" style={{ color: T.textPrimary }}>{data && !data.isToday ? 'Open issues that day' : 'Open issues today'}</h2>
          <p className="text-[13.5px] mt-1 leading-snug max-w-[75ch]" style={{ color: T.textBody }} data-testid="issues-summary">
            {data ? summary(open, issues.filter((i) => i.status === 'achieved').length) : err ? '' : 'Reading the inbox, payments, listings and accounts…'}
          </p>
          {data && <p className="text-[11.5px] mt-1" style={{ color: T.textMuted }}>{data.sources?.chats ?? 0} WhatsApp chats read · checked {fmtDate(data.generatedAt, true)}{data.mode === 'test' ? ' · demo (Relay test chats)' : ''}</p>}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <label className="flex items-center gap-1.5 text-[12px]" style={{ color: T.textSecondary }}>
            <input type="checkbox" checked={showHandled} onChange={(e) => setShowHandled(e.target.checked)} className="accent-ink" /> Show handled
          </label>
          {(!data || data.isToday) && <button type="button" onClick={() => load(true)} disabled={loading} className={btnSecondary} style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary }} data-testid="issues-refresh">{loading ? 'Checking…' : 'Check again'}</button>}
        </div>
      </div>
      {err && <div className="px-5 py-3"><Banner>Could not load the open issues: {err}</Banner></div>}
      {!data && !err && <div className="px-5 py-4 space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-10 rounded-[10px] animate-pulse" style={{ background: 'rgba(17,17,17,.05)' }} />)}</div>}
      {groups.map(([g, list]) => (
        <div key={g} className="px-5 py-3 border-b last:border-b-0" style={{ borderColor: T.borderLight }}>
          <h3 className="text-[12.5px] font-semibold mb-1" style={{ color: g === 'Results' ? T.success : T.textMuted }}>{g === 'Results' ? `Results — goal reached after the assistant's answer · ${list.length}` : `${g} · ${list.filter((i) => i.status === 'open').length}`}</h3>
          <ul>{list.map((i) => <Issue key={i.id} issue={i} onAction={onAction} busy={busy[i.id]} mode={data?.mode} />)}</ul>
        </div>
      ))}
    </section>
  );
}
