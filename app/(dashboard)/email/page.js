'use client';
// Email (info@) — the info@casa-libre.com Gmail mailbox inside the admin, through the Apps Script
// bridge (lib/gmailBridge.js). Read every thread, reply in the same Gmail thread, write new
// emails from info@, and mark read / archive / spam / trash (Gmail stays in sync). The AI sorts
// each email (Enquiry / Business / Notification / Marketing / Spam) and alerts the team about the
// important ones. Opening an email does not mark it read: it stays unread until it's handled.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { T, CARD, PageHeader, Pill, Banner, inputCls, btnPrimary, btnSecondary } from '@/components/automations/ui';
import { CATEGORIES, VIEWS, parseAddress } from '@/lib/emailTriageCore';

const VIEW_KEYS = Object.keys(VIEWS);

// A calm note (Banner only has error / warning looks).
function Note({ tone = 'info', children }) {
  const c = tone === 'success' ? [T.successSurface, T.success] : [T.infoSurface, T.info];
  return <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: c[0], color: c[1] }}>{children}</div>;
}

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}
const fullWhen = (iso) => (iso ? new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function CategoryPill({ cat }) {
  const c = CATEGORIES[cat];
  if (!c) return null;
  return <Pill tone={c.tone}>{c.name}</Pill>;
}

// The email's own HTML, isolated: no scripts run; links open in a new tab.
function HtmlBody({ html }) {
  const ref = useRef(null);
  const [h, setH] = useState(120);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font-family:Arial,sans-serif;font-size:14px;color:#111;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`, [html]);
  const fit = () => {
    try { const b = ref.current?.contentDocument?.documentElement; if (b) setH(Math.min(4000, b.scrollHeight + 8)); } catch { /* cross-origin */ }
  };
  return <iframe ref={ref} title="Email" srcDoc={doc} onLoad={() => { fit(); setTimeout(fit, 400); }} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="w-full border-0" style={{ height: h }} />;
}

function Message({ m, open, onToggle }) {
  const who = parseAddress(m.from);
  const [en, setEn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showHtml, setShowHtml] = useState(true);
  const translate = async () => {
    if (en) { setEn(null); return; }
    setBusy(true);
    const r = await fetch('/api/translate-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(m.text || '').slice(0, 5000) }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    setEn(r?.text || 'Could not translate this email.');
  };
  return (
    <div className="py-3" style={{ borderBottom: `1px solid ${T.borderLight}` }}>
      <button type="button" onClick={onToggle} className="w-full text-left flex items-start gap-3">
        <span className="h-8 w-8 shrink-0 rounded-full flex items-center justify-center text-[13px] font-semibold" style={{ background: m.sentByUs ? T.infoSurface : T.bgSurface, color: m.sentByUs ? T.info : T.textBody }}>
          {(who.name || '?').trim().charAt(0).toUpperCase()}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="text-[13.5px] font-semibold truncate" style={{ color: T.textPrimary }}>{m.sentByUs ? `Casa-Libre (info@)` : who.name}</span>
            <span className="text-[11.5px] shrink-0" style={{ color: T.textMuted }}>{fullWhen(m.date)}</span>
          </span>
          <span className="block text-[11.5px] truncate" style={{ color: T.textMuted }}>
            {m.sentByUs ? `to ${m.to}` : who.email}{m.cc ? ` · cc ${m.cc}` : ''}
          </span>
          {!open && <span className="block text-[12.5px] truncate mt-0.5" style={{ color: T.textSecondary }}>{String(m.text || '').replace(/\s+/g, ' ').slice(0, 160)}</span>}
        </span>
      </button>
      {open && (
        <div className="mt-3 pl-11">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={translate} disabled={busy}>{busy ? 'Translating…' : en ? 'Show original' : 'English'}</button>
            {m.html && !en && <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => setShowHtml(!showHtml)}>{showHtml ? 'Plain text' : 'Formatted'}</button>}
          </div>
          {en ? (
            <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed p-3 rounded-[10px]" style={{ fontFamily: 'inherit', background: T.infoSurface, color: T.textPrimary }}>{en}</pre>
          ) : m.html && showHtml ? (
            <HtmlBody html={m.html} />
          ) : (
            <pre className="whitespace-pre-wrap text-[13.5px] leading-relaxed" style={{ fontFamily: 'inherit', color: T.textBody }}>{m.text}</pre>
          )}
          {m.attachments?.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-3">
              {m.attachments.map((a) => (
                <a key={a.index} href={`/api/email/attachment?messageId=${encodeURIComponent(m.id)}&index=${a.index}`} className="text-[12px] px-3 py-1.5 rounded-full hover:bg-black/[.04]" style={{ border: `1px solid ${T.borderLight}`, color: T.textBody }}>
                  {a.name} · {kb(a.size)}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Compose({ onClose, onSent }) {
  const [to, setTo] = useState(''); const [subject, setSubject] = useState(''); const [text, setText] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    const r = await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send', to, subject, text }) }).then((x) => x.json()).catch(() => ({ error: 'Could not send. Try again.' }));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    onSent();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(17,17,17,.35)' }} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="w-full max-w-[620px] p-5" style={{ ...CARD }}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[16px] font-semibold" style={{ color: T.textPrimary }}>New email from info@casa-libre.com</h2>
          <button type="button" onClick={onClose} className="text-[13px]" style={{ color: T.textSecondary }}>Close</button>
        </div>
        <div className="space-y-3">
          <input className={inputCls} placeholder="To (email address)" value={to} onChange={(e) => setTo(e.target.value)} autoFocus />
          <input className={inputCls} placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className={inputCls} rows={10} placeholder="Message" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {err && <div className="mt-3"><Banner>{err}</Banner></div>}
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={onClose}>Cancel</button>
          <button type="button" className={btnPrimary} onClick={send} disabled={busy || !to || !subject || !text}>{busy ? 'Sending…' : 'Send email'}</button>
        </div>
      </div>
    </div>
  );
}

function Reader({ id, onChanged, onClose }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [reply, setReply] = useState('');
  const [all, setAll] = useState(false);
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(() => {
    setErr('');
    fetch(`/api/email/thread?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => {
      if (d.error) { setErr(d.error); return; }
      setData(d);
      const last = d.messages[d.messages.length - 1];
      setOpen(last ? { [last.id]: true } : {});
    }).catch(() => setErr('Could not load this email. Try again.'));
  }, [id]);
  useEffect(() => { setData(null); setReply(''); setNote(''); load(); }, [load]);

  const modify = async (op, label) => {
    setBusy(op); setNote('');
    const r = await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'modify', threadId: id, op }) }).then((x) => x.json()).catch(() => ({ error: 'failed' }));
    setBusy('');
    if (r.error) { setNote(`Could not ${label.toLowerCase()}: ${r.error}`); return; }
    setData((d) => (d ? { ...d, thread: { ...d.thread, ...r.thread } } : d));
    onChanged(id, r.thread, op);
    setNote(`${label}.`);
  };

  const sendReply = async () => {
    const lastIn = [...(data?.messages || [])].reverse().find((m) => !m.sentByUs) || data?.messages?.[data.messages.length - 1];
    if (!lastIn) return;
    setBusy('reply'); setNote('');
    const r = await fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reply', messageId: lastIn.id, text: reply, all }) }).then((x) => x.json()).catch(() => ({ error: 'Could not send. Try again.' }));
    setBusy('');
    if (r.error) { setNote(r.error); return; }
    setReply(''); setNote('Reply sent from info@casa-libre.com. The email is marked read.');
    onChanged(id, { unread: false }, 'read');
    setTimeout(load, 1500);
  };

  if (err) return <div className="p-5"><Banner>{err}</Banner></div>;
  if (!data) return <p className="p-5 text-[13px]" style={{ color: T.textMuted }}>Loading the email…</p>;
  const t = data.thread;
  return (
    <div className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <button type="button" onClick={onClose} className="lg:hidden text-[12px] mb-2" style={{ color: T.textSecondary }}>Back to the list</button>
          <h2 className="text-[17px] font-semibold leading-snug" style={{ color: T.textPrimary }}>{t.subject || '(no subject)'}</h2>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <CategoryPill cat={t.category} />
            {data.triage?.urgent && <Pill tone="danger">Reply today</Pill>}
            {t.unread ? <Pill tone="warning">Unread</Pill> : <Pill tone="neutral">Read</Pill>}
            {!t.inInbox && <Pill tone="neutral">Archived</Pill>}
          </div>
        </div>
      </div>
      {data.triage?.summary && (
        <p className="mt-3 text-[13px] p-3 rounded-[10px]" style={{ background: T.bgSurface, color: T.textBody }}>
          <span className="font-semibold" style={{ color: T.textPrimary }}>In short: </span>{data.triage.summary}
        </p>
      )}
      <div className="flex flex-wrap gap-2 mt-3">
        {t.unread
          ? <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => modify('read', 'Marked as handled (read)')}>Mark handled (read)</button>
          : <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => modify('unread', 'Marked unread')}>Mark unread</button>}
        {t.inInbox
          ? <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => modify('archive', 'Archived')}>Archive</button>
          : <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => modify('inbox', 'Moved to the inbox')}>Move to inbox</button>}
        <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => modify('spam', 'Reported as spam')}>Report spam</button>
        <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.danger }} disabled={!!busy} onClick={() => { if (window.confirm('Move this email to the trash in Gmail?')) modify('trash', 'Moved to the trash'); }}>Delete</button>
      </div>
      {note && <p className="text-[12.5px] mt-2" style={{ color: T.textSecondary }}>{note}</p>}

      <div className="mt-4" style={{ borderTop: `1px solid ${T.borderLight}` }}>
        {data.messages.map((m) => (
          <Message key={m.id} m={m} open={!!open[m.id]} onToggle={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} />
        ))}
      </div>

      <div className="mt-4">
        <label htmlFor="email-reply" className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>Reply from info@casa-libre.com</label>
        <textarea id="email-reply" className={`${inputCls} mt-1.5`} rows={6} placeholder="Write your reply…" value={reply} onChange={(e) => setReply(e.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2 mt-2">
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: T.textBody }}>
            <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Reply to everyone on the email
          </label>
          <button type="button" className={btnPrimary} disabled={!reply.trim() || busy === 'reply'} onClick={sendReply}>{busy === 'reply' ? 'Sending…' : 'Send reply'}</button>
        </div>
      </div>
    </div>
  );
}

function EmailInner() {
  const sp = useSearchParams();
  const [view, setView] = useState('inbox');
  const [hideJunk, setHideJunk] = useState(true);
  const [qIn, setQIn] = useState('');
  const [q, setQ] = useState('');
  const [threads, setThreads] = useState(null);
  const [more, setMore] = useState(false);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(sp.get('thread') || null);
  const [status, setStatus] = useState(null);
  const [compose, setCompose] = useState(false);
  const [flash, setFlash] = useState('');
  const sorting = useRef(new Set());

  useEffect(() => { fetch('/api/email/status').then((r) => r.json()).then(setStatus).catch(() => setStatus({ connected: false })); }, []);

  const load = useCallback((start = 0) => {
    setErr('');
    if (start === 0) setThreads(null);
    const qs = new URLSearchParams({ view, q, start: String(start), hideJunk: hideJunk ? '1' : '0' });
    fetch(`/api/email?${qs}`).then((r) => r.json()).then((d) => {
      if (d.error) { setErr(d.error === 'not_connected' ? 'The info@ mailbox is not connected (GMAIL_BRIDGE_URL / GMAIL_BRIDGE_SECRET).' : `Could not load the mailbox: ${d.error}`); setThreads([]); return; }
      setThreads((cur) => (start === 0 ? d.threads : [...(cur || []), ...d.threads]));
      setMore(!!d.more);
    }).catch(() => { setErr('Could not load the mailbox. Try again.'); setThreads([]); });
  }, [view, q, hideJunk]);
  useEffect(() => { load(0); }, [load]);

  // threads the AI hasn't sorted yet → sort them in the background (a few at a time)
  useEffect(() => {
    if (!threads?.length) return;
    const todo = threads.filter((t) => !t.category && !sorting.current.has(t.id) && view !== 'sent').slice(0, 8).map((t) => t.id);
    if (!todo.length) return;
    todo.forEach((id) => sorting.current.add(id));
    fetch('/api/email/triage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ threadIds: todo }) })
      .then((r) => r.json())
      .then((d) => setThreads((cur) => (cur || []).map((t) => (d.results?.[t.id] ? { ...t, category: d.results[t.id] } : t))))
      .catch(() => {});
  }, [threads, view]);

  const onChanged = (id, patch, op) => {
    setThreads((cur) => {
      const list = (cur || []).map((t) => (t.id === id ? { ...t, ...patch } : t));
      // leaving the current view (archived from the inbox, spam, trash) → drop it from the list
      if ((op === 'archive' && view !== 'all') || op === 'spam' || op === 'trash') return list.filter((t) => t.id !== id);
      return list;
    });
    if (op === 'spam' || op === 'trash') setSel(null);
  };

  const unreadCount = (threads || []).filter((t) => t.unread).length;
  const stale = status?.connected && status.lastPush && Date.now() - new Date(status.lastPush).getTime() > 10 * 60 * 1000;

  return (
    <div className="max-w-[1400px]">
      <PageHeader
        title="Email (info@)"
        sub="The info@casa-libre.com mailbox. The AI sorts every email; important ones alert the team. An email stays unread until it's handled."
        action={<button type="button" className={btnPrimary} onClick={() => setCompose(true)}>New email</button>}
      />
      {status && !status.connected && <div className="mb-3"><Banner>The info@ mailbox is not connected{status.reason ? ` (${status.reason})` : ''}.</Banner></div>}
      {stale && <div className="mb-3"><Banner tone="warning">No new-email check from Gmail since {fullWhen(status.lastPush)}. New emails may be late; the list below is still live.</Banner></div>}
      {status?.connected && !status.lastPush && <div className="mb-3"><Note>Connected to {status.account}. The list below is live; the every-minute push and alerts start once the admin's address is set in the Gmail script.</Note></div>}
      {flash && <div className="mb-3"><Note tone="success">{flash}</Note></div>}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        {VIEW_KEYS.map((k) => (
          <button key={k} type="button" onClick={() => { setView(k); setSel(null); }}
            className="text-[13px] px-3.5 py-1.5 rounded-full transition-colors"
            style={view === k ? { background: T.primary, color: '#fff' } : { border: `1px solid ${T.borderLight}`, color: T.textBody }}>
            {VIEWS[k].name}
          </button>
        ))}
        <form onSubmit={(e) => { e.preventDefault(); setQ(qIn.trim()); setSel(null); }} className="flex-1 min-w-[220px] flex gap-2">
          <input className={inputCls} style={{ paddingTop: 7, paddingBottom: 7 }} placeholder="Search (name, email, words, or Gmail search like from:tomas)…" value={qIn} onChange={(e) => { setQIn(e.target.value); if (!e.target.value) setQ(''); }} />
        </form>
        {(view === 'inbox' || view === 'unread') && (
          <label className="flex items-center gap-2 text-[12.5px]" style={{ color: T.textBody }}>
            <input type="checkbox" checked={!hideJunk} onChange={(e) => setHideJunk(!e.target.checked)} /> Show marketing and spam
          </label>
        )}
      </div>

      <div className="grid lg:grid-cols-[400px_1fr] gap-4 items-start">
        <div className={`${sel ? 'hidden lg:block' : ''}`} style={{ ...CARD, overflow: 'hidden' }}>
          <div className="px-4 py-2.5 text-[12px]" style={{ borderBottom: `1px solid ${T.borderLight}`, color: T.textMuted }}>
            {threads === null ? 'Loading…' : `${threads.length}${more ? '+' : ''} conversations${unreadCount ? ` · ${unreadCount} unread` : ''}`}
          </div>
          {err && <div className="p-3"><Banner>{err}</Banner></div>}
          {threads?.length === 0 && !err && <p className="p-4 text-[13px]" style={{ color: T.textMuted }}>No emails here.</p>}
          <div className="max-h-[75vh] overflow-y-auto">
            {(threads || []).map((t) => {
              const who = parseAddress(t.lastFrom);
              const on = sel === t.id;
              return (
                <button key={t.id} type="button" onClick={() => setSel(t.id)} className="w-full text-left px-4 py-3 block"
                  style={{ borderBottom: `1px solid ${T.borderLight}`, background: on ? T.bgSurface : 'transparent', boxShadow: on ? `inset 3px 0 0 ${T.primary}` : 'none' }}>
                  <span className="flex items-baseline justify-between gap-2">
                    <span className={`text-[13px] truncate ${t.unread ? 'font-bold' : 'font-medium'}`} style={{ color: T.textPrimary }}>
                      {/info@casa-libre\.com/i.test(who.email) ? 'Casa-Libre (info@)' : who.name}{t.count > 1 ? <span style={{ color: T.textMuted, fontWeight: 400 }}> ({t.count})</span> : null}
                    </span>
                    <span className="text-[11px] shrink-0" style={{ color: t.unread ? T.textPrimary : T.textMuted }}>{when(t.lastDate)}</span>
                  </span>
                  <span className={`block text-[12.5px] truncate ${t.unread ? 'font-semibold' : ''}`} style={{ color: T.textBody }}>{t.subject || '(no subject)'}</span>
                  <span className="flex items-center gap-2 mt-1">
                    {t.category ? <CategoryPill cat={t.category} /> : view !== 'sent' ? <span className="text-[10.5px]" style={{ color: T.textMuted }}>Sorting…</span> : null}
                    <span className="text-[11.5px] truncate" style={{ color: T.textMuted }}>{t.snippet}</span>
                  </span>
                </button>
              );
            })}
            {more && <button type="button" className="w-full py-3 text-[12.5px]" style={{ color: T.textSecondary }} onClick={() => load((threads || []).length)}>Load more</button>}
          </div>
        </div>

        <div className={`${sel ? '' : 'hidden lg:block'}`} style={{ ...CARD, minHeight: 300 }}>
          {sel
            ? <Reader key={sel} id={sel} onChanged={onChanged} onClose={() => setSel(null)} />
            : <p className="p-5 text-[13px]" style={{ color: T.textMuted }}>Pick an email on the left to read and answer it.</p>}
        </div>
      </div>

      {compose && <Compose onClose={() => setCompose(false)} onSent={() => { setCompose(false); setFlash('Email sent from info@casa-libre.com.'); if (view === 'sent') load(0); }} />}
    </div>
  );
}

export default function EmailPage() {
  return <Suspense fallback={null}><EmailInner /></Suspense>;
}
