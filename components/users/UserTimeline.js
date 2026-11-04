'use client';
// Analytics → a user: "Messages & activity" — everything that happened with this person in
// ONE list, newest first, in English: their WhatsApp chat (what they wrote, the team's replies),
// the AI assistant's replies / hand-overs (+ clicks on its links), the Admin Manager, their
// feedback, the emails and WhatsApp automations we sent, paid-listing steps, deleted listings.
// Data: /api/users/activity + /emails + /whatsapp + /paywall, merged by lib/userTimeline.js.
import React, { useEffect, useMemo, useState } from 'react';
import { Mail, MessageCircle, Home, Trash2, Star, MessagesSquare } from 'lucide-react';
import { T, CARD } from '@/components/automations/ui';
import { mergeTimeline, timelineCounts } from '@/lib/userTimeline';

const PAGE = 60;
const LONG = 180;

const fmtDay = (v) => { try { return new Date(v).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: new Date(v).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }); } catch { return '—'; } };
const fmtTime = (v) => { try { return new Date(v).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); } catch { return ''; } };
const fmtWhen = (v) => `${fmtDay(v)} · ${fmtTime(v)}`;
const pct = (v) => (v == null ? '—' : `${v}%`);

const WHO_STYLE = {
  them: [T.bgSurface, T.textPrimary, T.textPrimary],
  team: [T.warningSurface, T.warning, T.warning],
  ai: [T.successSurface, T.success, T.success],
  manager: [T.infoSurface, T.info, T.info],
  automation: [T.bgSurface, T.textSecondary, T.borderLight],
  feedback: [T.warningSurface, T.warning, T.warning],
};
const CHANNEL = {
  whatsapp: ['WhatsApp', MessageCircle, { background: '#E3F3EA', color: '#0F6E4A' }],
  email: ['Email', Mail, { background: T.bgSurface, color: T.textSecondary }],
  feedback: ['Feedback', Star, { background: T.warningSurface, color: T.warning }],
  activity: ['Paid listing', Home, { background: T.warningSurface, color: T.warning }],
  listing: ['Listing', Trash2, { background: T.dangerSurface, color: T.danger }],
};
const STEP_STATUS = {
  deleted: ['deleted', T.danger], paywall: ['payment step', T.warning], checkout: ['card form', T.info], paid: ['paid', T.success], gift: ['gift offered', T.info], gift_taken: ['gift taken', T.success], gift_lapsed: ['gift expired', T.textMuted],
  ph_opened: ['pay screen', T.info], ph_started: ['tapped pay', T.info], ph_paid: ['paid', T.success], ph_gift: ['gift taken', T.success], ph_gift_failed: ['gift failed', T.danger],
};
const statusColor = (s) => (['read', 'opened', 'clicked'].includes(s) ? T.success
  : s === 'delivered' ? T.info
    : ['failed', 'bounced', 'complained', 'suppressed'].includes(s) ? T.danger
      : T.textMuted);

const Chip = ({ style, children }) => (
  <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap" style={style}>{children}</span>
);
const ChannelChip = ({ ch }) => {
  const [label, Icon, style] = CHANNEL[ch] || CHANNEL.email;
  return <Chip style={style}><Icon className="w-3 h-3" />{label}</Chip>;
};
const Stars = ({ n }) => (
  <span className="inline-flex items-center gap-0.5 align-middle" aria-label={`${n} of 5 stars`}>
    {[1, 2, 3, 4, 5].map((i) => <Star key={i} className="w-3 h-3" style={{ color: i <= n ? (n <= 2 ? T.danger : T.warning) : T.borderLight, fill: i <= n ? (n <= 2 ? T.danger : T.warning) : 'none' }} />)}
  </span>
);

function Item({ it, onAskWhy, asking }) {
  const [open, setOpen] = useState(false);
  const [orig, setOrig] = useState(false);
  const [bg, fg, edge] = WHO_STYLE[it.who] || WHO_STYLE.automation;
  const text = orig && it.original ? it.original : it.text;
  const long = String(text || '').length > LONG || (it.detail || []).length > 0;
  const step = it.step;
  const stepStatus = step ? STEP_STATUS[step.kind] : null;
  const status = stepStatus ? stepStatus[0] : it.status;
  return (
    <li className="flex gap-3 py-2.5 border-t" style={{ borderColor: T.borderLight }} data-testid={`timeline-${it.who}`}>
      <div className="w-[104px] shrink-0 text-[11px] leading-tight pt-0.5" style={{ color: T.textSecondary }}>
        <span className="block">{fmtDay(it.at)}</span>
        <span className="block" style={{ color: T.textMuted }}>{fmtTime(it.at)}</span>
      </div>
      <div className="min-w-0 flex-1 pl-3" style={{ borderLeft: `2px solid ${edge}` }}>
        <div className="flex items-center gap-1.5 flex-wrap">
          <Chip style={{ background: bg, color: fg }}>{it.whoLabel}</Chip>
          <ChannelChip ch={it.channel} />
          <span className="text-[12px] font-semibold" style={{ color: T.textPrimary }}>{it.title}</span>
          {it.stars ? <Stars n={it.stars} /> : null}
          {it.testSend ? <Chip style={{ background: T.bgSurface, color: T.textMuted }}>test send</Chip> : null}
          {it.reportId ? <a href={`/manager/${it.reportId}#emails`} className="text-[10.5px] underline underline-offset-2" style={{ color: T.textSecondary }}>report</a> : null}
          {status ? (
            <span className="ml-auto text-[11px] font-semibold capitalize whitespace-nowrap" style={{ color: stepStatus ? stepStatus[1] : statusColor(status) }}>{status}</span>
          ) : null}
        </div>
        {text ? (
          <p className="text-[12px] mt-1 whitespace-pre-wrap break-words" style={{ color: T.textBody, ...(open ? {} : { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }) }}>{text}</p>
        ) : null}
        {(it.clicks || []).map((c, i) => (
          <p key={i} className="text-[11px] mt-0.5 font-medium" style={{ color: T.success }} data-testid="timeline-click">
            Clicked the link{c.path ? ` · ${c.path}` : ''} · {fmtWhen(c.at)}{c.n > 1 ? ` (${c.n} times)` : ''}
          </p>
        ))}
        {open && (it.detail || []).map((d, i) => <p key={i} className="text-[11px] mt-0.5 break-words" style={{ color: T.textSecondary }}>{d}</p>)}
        {it.untracked ? <p className="text-[10.5px] mt-0.5" style={{ color: T.textMuted }}>{it.untracked === 'before' ? 'Sent before email open tracking' : it.untracked === 'off' ? 'Opens not tracked' : 'From our log'}</p> : null}
        {step?.kind === 'deleted' && step.askedAt ? (
          <p className="text-[11px] mt-0.5" style={{ color: T.success }} data-testid="asked-why">Ask-why email sent {fmtWhen(step.askedAt)} (its opens / clicks are on the email row)</p>
        ) : step?.kind === 'deleted' && step.askable ? (
          <button type="button" onClick={() => onAskWhy(step.listingId)} disabled={asking === step.listingId} data-testid="send-ask-why"
            className="mt-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border disabled:opacity-50" style={{ borderColor: T.borderLight, color: T.textPrimary, background: '#fff' }}>
            {asking === step.listingId ? 'Sending…' : 'Send the “why did you delete it?” email'}
          </button>
        ) : null}
        {(long || it.original) ? (
          <div className="flex gap-3 mt-1">
            {long ? <button type="button" onClick={() => setOpen((v) => !v)} className="text-[10.5px] underline underline-offset-2" style={{ color: T.textSecondary }}>{open ? 'Less' : 'More'}</button> : null}
            {it.original ? <button type="button" onClick={() => setOrig((v) => !v)} className="text-[10.5px] underline underline-offset-2" style={{ color: T.textMuted }} data-testid="timeline-original">{orig ? 'English' : 'Original'}</button> : null}
          </div>
        ) : null}
      </div>
    </li>
  );
}

export default function UserTimeline({ email, userId }) {
  const [em, setEm] = useState(null);   // /api/users/emails body or { error }
  const [wa, setWa] = useState(null);   // /api/users/whatsapp body or { error }
  const [pw, setPw] = useState(null);   // /api/users/paywall body or { error }
  const [act, setAct] = useState(null); // /api/users/activity body or { error }
  const [only, setOnly] = useState('all');
  const [shown, setShown] = useState(PAGE);
  const [asking, setAsking] = useState(null);
  const [askErr, setAskErr] = useState('');
  const [reload, setReload] = useState(0);

  // a deleted listing → send its "why did you delete it?" email now (/api/users/deleted-ask)
  const askWhy = async (propertyId) => {
    setAsking(propertyId);
    try {
      const r = await fetch('/api/users/deleted-ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ propertyId }) });
      const j = await r.json().catch(() => ({}));
      setAskErr(!r.ok && r.status !== 409 ? (j.error || 'Could not send it.') : '');
    } finally { setAsking(null); setReload((n) => n + 1); }
  };

  useEffect(() => {
    if (!email) return undefined;
    let cancelled = false;
    setEm(null); setWa(null); setPw(null); setAct(null);
    const get = (path, set) => fetch(`${path}${path.includes('?') ? '&' : '?'}email=${encodeURIComponent(email)}`).then((r) => r.json())
      .then((j) => { if (!cancelled) set(j); }).catch(() => { if (!cancelled) set({ error: 'unavailable' }); });
    const uid = userId ? `?userId=${encodeURIComponent(userId)}` : '';
    get('/api/users/emails', setEm);
    get('/api/users/whatsapp', setWa);
    get(`/api/users/paywall${uid}`, setPw);
    get(`/api/users/activity${uid}`, setAct);
    return () => { cancelled = true; };
  }, [email, userId, reload]);

  const loading = em === null || wa === null || pw === null;
  const items = useMemo(() => mergeTimeline(act && !act.error ? act.items || [] : [], {
    emails: em && !em.error ? em.emails || [] : [],
    whatsapp: wa && !wa.error ? wa.messages || [] : [],
    steps: pw && !pw.error && pw.found ? pw.events || [] : [],
    relayOf: act && !act.error ? act.relayOf || {} : {},
  }), [em, wa, pw, act]);
  const counts = timelineCounts(items);
  const rows = only === 'all' ? items : only.startsWith('who:') ? items.filter((i) => `who:${i.who}` === only) : items.filter((i) => i.channel === only);
  const es = em && !em.error ? em.summary : null;
  const ws = wa && !wa.error ? wa.summary : null;
  const phone = (act && !act.error && act.phone) || (wa && !wa.error && wa.phone) || null;
  const chatUrl = act && !act.error ? act.chatUrl : null;

  const filters = [
    ['all', 'All'], ['whatsapp', 'WhatsApp'], ['email', 'Email'], ['feedback', 'Feedback'],
    ['who:them', 'From them'], ['who:ai', 'AI assistant'], ['who:team', 'Team'], ['who:manager', 'Admin Manager'],
    ['activity', 'Paid listing'], ['listing', 'Deleted listings'],
  ].filter(([v]) => v === 'all' || counts[v]);

  return (
    <div className="p-5" style={CARD} data-testid="user-messages">
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <MessagesSquare className="w-4 h-4" style={{ color: T.primary }} />
        <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Messages &amp; activity</h2>
        <span className="text-xs" style={{ color: T.textMuted }}>everything with this person, in English, newest first</span>
        <span className="ml-auto flex items-center gap-2">
          {wa && !wa.error ? (
            <span className="text-[11px]" style={{ color: T.textMuted }}>
              WhatsApp: {phone ? `${phone} · ${wa.verified ? 'verified' : 'not verified'}` : 'no number'}{wa.optedOut ? ' · opted out' : ''}
            </span>
          ) : null}
          {chatUrl ? (
            <a href={chatUrl} className="inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: T.primary, color: T.bgWhite }} data-testid="open-chat">
              <MessageCircle className="w-3 h-3" /> Open chat{act.mode === 'test' ? ' (test)' : ''}
            </a>
          ) : null}
        </span>
      </div>

      {loading ? (
        <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-3">
            {[
              ['Emails sent', es ? es.total : '—', es?.codes ? `${es.codes} code${es.codes === 1 ? '' : 's'}` : ''],
              ['Email open rate', es ? pct(es.openRate) : '—', es?.measured ? `${es.opened} of ${es.measured}` : ''],
              ['Email click rate', es ? pct(es.clickRate) : '—', es?.measured ? `${es.clicked} of ${es.measured}` : ''],
              ['WhatsApp sent', ws ? ws.sent : '—', ws?.failed ? `${ws.failed} failed` : ''],
              ['WhatsApp read rate', ws ? pct(ws.readRate) : '—', ws?.delivered ? `${ws.read} of ${ws.delivered}` : ''],
              ['WhatsApp clicks', ws ? ws.clicked : '—', wa?.clicksNote ? 'PostHog not available' : ''],
            ].map(([label, value, sub]) => (
              <div key={label}>
                <p className="text-lg font-bold" style={{ color: T.textPrimary }}>{value}</p>
                <p className="text-[10px]" style={{ color: T.textMuted }}>{label}{sub ? ` · ${sub}` : ''}</p>
              </div>
            ))}
          </div>
          <p className="text-[11px] mb-3" style={{ color: T.textMuted }}>
            Rates leave out sign-in / password-reset codes and test sends.
            {act === null ? ' Loading their WhatsApp chat, AI assistant and feedback…' : ''}
            {act?.error ? ' Couldn’t load their WhatsApp chat, AI assistant and feedback right now.' : ''}
            {act && !act.error && act.chatNote === 'not_configured' ? ' The WhatsApp chat isn’t connected here (Relay key not set).' : ''}
            {act && !act.error && act.chatNote && !['not_configured', 'no_chat', 'no_phone'].includes(act.chatNote) ? ` Couldn’t read their WhatsApp chat (${act.chatNote}).` : ''}
            {em?.error ? ' Couldn’t load their emails right now.' : ''}
            {wa?.error ? ' Couldn’t load their WhatsApp messages right now.' : ''}
            {em?.emails?.some((e) => e.untracked === 'before') && em.trackingSince ? ` Email opens and clicks are only recorded since ${fmtDay(em.trackingSince)}.` : ''}
            {em?.tracking === 'no_key' ? ' Email opens/clicks need RESEND_READ_API_KEY: only automation emails from our own log are shown.' : ''}
            {em?.tracking === 'error' ? ` Resend couldn't be read right now (${em.trackingError}).` : ''}
          </p>
          {askErr ? <p className="text-[12px] mb-3" style={{ color: T.danger }}>Ask-why email: {askErr}</p> : null}
          <div className="flex flex-wrap gap-1 mb-2">
            {filters.map(([v, l]) => (
              <button key={v} type="button" onClick={() => { setOnly(v); setShown(PAGE); }} className="px-2.5 py-1 rounded-full text-[11px] font-medium border"
                style={only === v ? { background: T.primary, color: T.bgWhite, borderColor: T.primary } : { color: T.textSecondary, borderColor: T.borderLight, background: T.bgWhite }}>
                {l}{v === 'all' ? '' : ` ${counts[v]}`}
              </button>
            ))}
          </div>
          {rows.length === 0 ? (
            <p className="text-xs" style={{ color: T.textMuted }}>Nothing with this person yet.</p>
          ) : (
            <>
              <ul data-testid="user-timeline">
                {rows.slice(0, shown).map((it) => <Item key={it.key} it={it} onAskWhy={askWhy} asking={asking} />)}
              </ul>
              {rows.length > shown ? (
                <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-2 text-[11px] font-semibold px-3 py-1 rounded-full border" style={{ borderColor: T.borderLight, color: T.textPrimary }}>
                  Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}
                </button>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}
