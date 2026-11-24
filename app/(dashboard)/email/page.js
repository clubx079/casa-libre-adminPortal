'use client';
// Email (info@) — the info@casa-libre.com mailbox, laid out like Gmail: folders on the left
// (Inbox, Important, Marketing, Other, Sent, Spam, Trash, All mail), the list with checkboxes,
// stars and hover actions, and the conversation view with Reply / Reply all / Forward.
// Everything shows at once from the saved copy (control DB, lib/emailStore.js); the newest mail is
// fetched from Gmail in the background and the page updates itself. The AI sorts each email
// (Important = real enquiries, Marketing, Other, Spam). Opening an email never marks it read: it
// stays unread until someone handles it (Roland's rule).
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { CATEGORIES, CATEGORY_KEYS as CATEGORY_KEYS_UI, parseAddress } from '@/lib/emailTriageCore';
import { refreshUnread } from '@/components/unread';

// Gmail's own palette for this one page
const C = {
  page: '#F6F8FC', card: '#FFFFFF', text: '#1F1F1F', sub: '#444746', muted: '#5E5E5E', faint: '#747775',
  line: '#E0E3E7', readRow: '#F2F6FC', hover: '#E8EAED', sel: '#D3E3FD', selText: '#041E49',
  compose: '#C2E7FF', blue: '#0B57D0', search: '#EAF1FB', star: '#F4B400', red: '#B3261E',
};
const CAT_COLORS = {
  important: { bg: '#DDF3E4', fg: '#146C2E' },
  marketing: { bg: '#FEEFC3', fg: '#7A4F01' },
  other: { bg: '#E8EAED', fg: '#444746' },
  spam: { bg: '#FCE8E6', fg: '#A50E0E' },
};
const AVATAR = ['#1A73E8', '#D93025', '#188038', '#E37400', '#9334E6', '#007B83', '#C5221F', '#1967D2'];

// ── small icons (Material-style) ──
const P = {
  inbox: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 12h-4a3 3 0 0 1-6 0H5V5h14v10z',
  important: 'M12 2 4 5v6c0 5.5 3.4 10.6 8 12 4.6-1.4 8-6.5 8-12V5l-8-3zm-1 15-4-4 1.4-1.4L11 14.2l5.6-5.6L18 10l-7 7z',
  marketing: 'M21 7 12 2 3 7v2h18V7zM5 11v6h3v-6H5zm5.5 0v6h3v-6h-3zM16 11v6h3v-6h-3zM3 19v2h18v-2H3z',
  other: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
  sent: 'M2.01 21 23 12 2.01 3 2 10l15 2-15 2z',
  spam: 'M15.73 3H8.27L3 8.27v7.46L8.27 21h7.46L21 15.73V8.27L15.73 3zM13 17h-2v-2h2v2zm0-4h-2V7h2v6z',
  trash: 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  all: 'M20 6h-8l-2-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2z',
  pencil: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z',
  search: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  gear: 'M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.61-.22l-2.39.96a7.03 7.03 0 0 0-1.62-.94l-.36-2.54A.5.5 0 0 0 13.9 2h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.67 8.48a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.61.22l2.39-.96c.49.38 1.03.7 1.62.94l.36 2.54c.05.24.25.42.49.42h3.84c.24 0 .45-.18.49-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.48 0 .61-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z',
  refresh: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
  back: 'M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z',
  archive: 'M20.54 5.23 19.15 3.55A1.45 1.45 0 0 0 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.23A1.98 1.98 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.48-.17-.93-.46-1.27zM12 17.5 6.5 12H10v-2h4v2h3.5L12 17.5zM5.12 5l.81-1h12l.94 1H5.12z',
  unarchive: 'M20.55 5.22 19.16 3.54A1.45 1.45 0 0 0 18 3H6c-.47 0-.88.21-1.16.55L3.46 5.22A2 2 0 0 0 3 6.5V19a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6.5c0-.48-.17-.93-.45-1.28zM12 9.5l5.5 5.5H14v2h-4v-2H6.5L12 9.5zM5.12 5l.82-1h12l.93 1H5.12z',
  markRead: 'M21.99 8c0-.72-.37-1.35-.94-1.7L12 1 2.95 6.3C2.38 6.65 2 7.28 2 8v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2l-.01-10zM12 13 3.74 7.84 12 3l8.26 4.84L12 13z',
  markUnread: 'M20 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2zm0 4-8 5-8-5V6l8 5 8-5v2z',
  star: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  starOutline: 'M22 9.24l-7.19-.62L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21 12 17.27 18.18 21l-1.63-7.03L22 9.24zM12 15.4l-3.76 2.27 1-4.28-3.32-2.88 4.38-.38L12 6.1l1.71 4.04 4.38.38-3.32 2.88 1 4.28L12 15.4z',
  reply: 'M10 9V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  replyAll: 'M7 8V5l-7 7 7 7v-3l-4-4 4-4zm6 1V5l-7 7 7 7v-4.1c5 0 8.5 1.6 11 5.1-1-5-4-10-11-11z',
  forward: 'M14 9V5l7 7-7 7v-4.1c-5 0-8.5 1.6-11 5.1 1-5 4-10 11-11z',
  clip: 'M16.5 6v11.5a4 4 0 0 1-8 0V5a2.5 2.5 0 0 1 5 0v10.5a1 1 0 0 1-2 0V6H10v9.5a2.5 2.5 0 0 0 5 0V5a4 4 0 0 0-8 0v12.5a5.5 5.5 0 0 0 11 0V6h-1.5z',
  left: 'M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z',
  right: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  close: 'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z',
  translate: 'm12.87 15.07-2.54-2.51.03-.03A17.52 17.52 0 0 0 14.07 6H17V4h-7V2H8v2H1v2h11.17C11.5 7.92 10.44 9.75 9 11.35 8.07 10.32 7.3 9.19 6.69 8h-2c.73 1.63 1.73 3.17 2.98 4.56l-5.09 5.02L4 19l5-5 3.11 3.11.76-2.04zM18.5 10h-2L12 22h2l1.12-3h4.75L21 22h2l-4.5-12zm-2.62 7 1.62-4.33L19.12 17h-3.24z',
};
function Icon({ d, size = 20, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill={color} aria-hidden="true"><path d={P[d] || d} /></svg>;
}
function IconBtn({ icon, title, onClick, disabled, size = 20, color }) {
  return (
    <button type="button" title={title} aria-label={title} onClick={onClick} disabled={disabled}
      className="h-10 w-10 inline-flex items-center justify-center rounded-full hover:bg-black/[.06] disabled:opacity-40 shrink-0" style={{ color: color || C.sub }}>
      <Icon d={icon} size={size} />
    </button>
  );
}

const FOLDERS = [
  { key: 'inbox', name: 'Inbox', icon: 'inbox' },
  { key: 'important', name: 'Important', icon: 'important' },
  { key: 'marketing', name: 'Marketing', icon: 'marketing' },
  { key: 'other', name: 'Other', icon: 'other' },
  { key: 'sent', name: 'Sent', icon: 'sent' },
  { key: 'spam', name: 'Spam', icon: 'spam' },
  { key: 'trash', name: 'Trash', icon: 'trash' },
  { key: 'all', name: 'All mail', icon: 'all' },
];

function listDate(iso) {
  if (!iso) return '';
  const d = new Date(iso); const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
}
function longDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const ms = Date.now() - d.getTime();
  const days = Math.floor(ms / 86400000);
  const base = d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric', hour: 'numeric', minute: '2-digit' });
  if (days < 1) return `${base} (${Math.max(1, Math.round(ms / 3600000))} hours ago)`;
  return days < 30 ? `${base} (${days} day${days === 1 ? '' : 's'} ago)` : base;
}
const kb = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const isUs = (from) => /info@casa-libre\.com/i.test(String(from || ''));
const shortName = (from) => {
  if (isUs(from)) return 'me';
  const a = parseAddress(from);
  return a.name && a.name !== a.email ? a.name : a.email.split('@')[0];
};
const colorFor = (s) => AVATAR[[...String(s || '?')].reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR.length];

function Chip({ cat }) {
  const c = CATEGORIES[cat]; const col = CAT_COLORS[cat];
  if (!c) return null;
  return <span className="text-[11px] leading-none px-1.5 py-[3px] rounded mr-1.5 shrink-0 font-medium" style={{ background: col.bg, color: col.fg }}>{c.name}</span>;
}

function Avatar({ from, size = 40 }) {
  const who = parseAddress(from);
  const label = isUs(from) ? 'C' : (who.name || who.email || '?').trim().charAt(0).toUpperCase();
  return <span className="rounded-full inline-flex items-center justify-center text-white font-medium shrink-0" style={{ width: size, height: size, background: isUs(from) ? C.blue : colorFor(who.email), fontSize: size * 0.45 }}>{label}</span>;
}

async function post(body) {
  return fetch('/api/email', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: 'Could not reach the server.' }));
}

// ── the email's own HTML, isolated: no scripts; links open in a new tab ──
function HtmlBody({ html }) {
  const ref = useRef(null);
  const [h, setH] = useState(80);
  const doc = useMemo(() => `<!doctype html><html><head><meta charset="utf-8"><base target="_blank"><style>body{margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222;word-wrap:break-word}img{max-width:100%;height:auto}table{max-width:100%}</style></head><body>${html}</body></html>`, [html]);
  const fit = () => { try { const b = ref.current?.contentDocument?.documentElement; if (b) setH(Math.min(6000, b.scrollHeight + 4)); } catch { /* ignore */ } };
  return <iframe ref={ref} title="Email" srcDoc={doc} onLoad={() => { fit(); setTimeout(fit, 500); }} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="w-full border-0 block" style={{ height: h }} />;
}

// ── one email inside a conversation ──
function Message({ m, open, onToggle, onReply, unread, onReadToggle, onSender }) {
  const who = parseAddress(m.from);
  const [en, setEn] = useState(null);
  const [busy, setBusy] = useState(false);
  const [showTo, setShowTo] = useState(false);
  const translate = async () => {
    if (en) { setEn(null); return; }
    setBusy(true);
    const r = await fetch('/api/translate-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: String(m.text || '').slice(0, 5000) }) }).then((x) => x.json()).catch(() => null);
    setBusy(false);
    setEn(r?.text || 'Could not translate this email.');
  };
  if (!open) {
    return (
      <button type="button" onClick={onToggle} className="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-black/[.02]" style={{ borderTop: `1px solid ${C.line}` }}>
        <Avatar from={m.from} size={36} />
        <span className="w-[180px] shrink-0 truncate text-[14px] font-semibold" style={{ color: C.text }}>{isUs(m.from) ? 'Casa-Libre' : who.name}</span>
        <span className="flex-1 truncate text-[14px]" style={{ color: C.muted }}>{String(m.text || '').replace(/\s+/g, ' ').slice(0, 200)}</span>
        <span className="text-[12px] shrink-0" style={{ color: C.muted }}>{listDate(m.date)}</span>
      </button>
    );
  }
  return (
    <div className="px-4 pt-4 pb-2" style={{ borderTop: `1px solid ${C.line}` }}>
      <div className="flex items-start gap-3">
        <Avatar from={m.from} />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3">
            <div className="text-left min-w-0">
              <button type="button" onClick={onToggle} className="text-[14px] font-semibold" style={{ color: C.text }}>{isUs(m.from) ? 'Casa-Libre' : who.name}</button>
              <span className="text-[12px] ml-1" style={{ color: C.muted }}>&lt;{who.email}&gt;</span>
              {!isUs(m.from) && who.email && (
                <button type="button" onClick={() => onSender(who.email)} className="ml-2 text-[12px] hover:underline" style={{ color: C.blue }} title={`Every email from ${who.email}`}>
                  All emails from {who.name.split(/\s+/)[0] || who.email}
                </button>
              )}
            </div>
            <div className="flex items-center shrink-0">
              <span className="text-[12px] mr-1 hidden sm:inline" style={{ color: C.muted }}>{longDate(m.date)}</span>
              <IconBtn icon={unread ? 'markRead' : 'markUnread'} title={unread ? 'Mark as read (handled)' : 'Mark as unread'} onClick={onReadToggle} size={18} />
              <IconBtn icon="reply" title="Reply" onClick={() => onReply('reply', m)} size={18} />
            </div>
          </div>
          <button type="button" onClick={() => setShowTo((v) => !v)} className="text-[12px] -mt-1" style={{ color: C.muted }}>
            to {isUs(m.to) ? 'me' : (parseAddress(m.to).name || m.to)}{m.cc ? `, cc ${m.cc}` : ''} ▾
          </button>
          {showTo && (
            <div className="text-[12px] mt-1 p-2 rounded" style={{ border: `1px solid ${C.line}`, color: C.sub }}>
              <div>from: {m.from}</div><div>to: {m.to}</div>{m.cc ? <div>cc: {m.cc}</div> : null}<div>date: {new Date(m.date).toLocaleString('en-US')}</div><div>subject: {m.subject}</div>
            </div>
          )}
        </div>
      </div>
      <div className="sm:pl-[52px] mt-3">
        <button type="button" onClick={translate} disabled={busy} className="inline-flex items-center gap-1 text-[12px] mb-2 hover:underline" style={{ color: C.blue }}>
          <Icon d="translate" size={14} color={C.blue} /> {busy ? 'Translating…' : en ? 'Show original' : 'Translate to English'}
        </button>
        {en ? <div className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: C.text }}>{en}</div>
          : m.html ? <HtmlBody html={m.html} />
            : <div className="whitespace-pre-wrap text-[14px] leading-relaxed" style={{ color: C.text }}>{m.text}</div>}
        {m.attachments?.length > 0 && (
          <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${C.line}` }}>
            <p className="text-[13px] font-medium mb-2" style={{ color: C.sub }}>{m.attachments.length} attachment{m.attachments.length === 1 ? '' : 's'}</p>
            <div className="flex flex-wrap gap-2">
              {m.attachments.map((a) => (
                <a key={a.index} href={`/api/email/attachment?messageId=${encodeURIComponent(m.id)}&index=${a.index}`}
                  className="w-[180px] rounded-lg px-3 py-2.5 hover:shadow" style={{ border: `1px solid ${C.line}` }}>
                  <span className="flex items-center gap-1.5 text-[13px]" style={{ color: C.text }}><Icon d="clip" size={16} color={C.muted} /> <span className="truncate">{a.name}</span></span>
                  <span className="block text-[11px] mt-0.5" style={{ color: C.muted }}>{kb(a.size)}</span>
                </a>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── inline reply / reply all / forward box under the conversation ──
function ReplyBox({ mode, msg, thread, onClose, onSent }) {
  const fwd = mode === 'forward';
  const who = parseAddress(msg.from);
  const [to, setTo] = useState(fwd ? '' : who.email);
  const [text, setText] = useState(fwd ? `\n\n---------- Forwarded message ---------\nFrom: ${msg.from}\nDate: ${new Date(msg.date).toLocaleString('en-US')}\nSubject: ${msg.subject}\nTo: ${msg.to}\n\n${msg.text || ''}` : '');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); if (fwd && ref.current) ref.current.setSelectionRange(0, 0); }, [fwd]);
  const send = async () => {
    setBusy(true); setErr('');
    const r = fwd
      ? await post({ action: 'send', to, subject: /^fwd?:/i.test(thread.subject) ? thread.subject : `Fwd: ${thread.subject}`, text })
      : await post({ action: 'reply', messageId: msg.id, text, all: mode === 'replyAll' });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    onSent(fwd ? 'Message forwarded.' : 'Reply sent.');
  };
  return (
    <div className="mx-4 mb-4 rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,.2),0_4px_8px_rgba(0,0,0,.1)]" style={{ background: C.card }}>
      <div className="flex items-center gap-2 px-4 pt-3 text-[13px]" style={{ color: C.muted }}>
        <Icon d={fwd ? 'forward' : mode === 'replyAll' ? 'replyAll' : 'reply'} size={18} color={C.muted} />
        {fwd
          ? <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" className="flex-1 outline-none text-[14px] py-1" style={{ color: C.text }} />
          : <span className="truncate" style={{ color: C.text }}>{mode === 'replyAll' ? `${who.name} and others` : `${who.name} <${who.email}>`}</span>}
      </div>
      <textarea ref={ref} value={text} onChange={(e) => setText(e.target.value)} rows={fwd ? 10 : 6} className="w-full px-4 py-3 outline-none text-[14px] resize-y" style={{ color: C.text }} />
      {err && <p className="px-4 pb-2 text-[12.5px]" style={{ color: C.red }}>{err}</p>}
      <div className="flex items-center justify-between px-3 pb-3">
        <button type="button" onClick={send} disabled={busy || !text.trim() || (fwd && !to.trim())}
          className="px-6 h-9 rounded-full text-[14px] font-medium text-white disabled:opacity-50" style={{ background: C.blue }}>{busy ? 'Sending…' : 'Send'}</button>
        <IconBtn icon="trash" title="Discard" onClick={onClose} size={18} />
      </div>
    </div>
  );
}

// ── the conversation view ──
function Conversation({ id, folder, onBack, onChanged, onFlash, onSender }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState({});
  const [reply, setReply] = useState(null);   // { mode, msg }
  const [busy, setBusy] = useState(false);

  const apply = (d) => {
    setData(d);
    setOpen((o) => {
      const next = { ...o };
      const last = d.messages[d.messages.length - 1];
      if (last) next[last.id] = true;
      d.messages.filter((m) => m.unread).forEach((m) => { next[m.id] = true; });
      return next;
    });
  };
  const fresh = (base) => fetch(`/api/email/thread?id=${encodeURIComponent(id)}&fresh=1`).then((r) => r.json()).then((f) => {
    if (!f.error) apply({ ...f, thread: { ...f.thread, category: f.thread.category || base?.thread?.category } });
  }).catch(() => {});
  useEffect(() => {
    let alive = true;
    setData(null); setErr(''); setReply(null); setOpen({});
    fetch(`/api/email/thread?id=${encodeURIComponent(id)}`).then((r) => r.json()).then((d) => {
      if (!alive) return;
      if (d.error) { setErr(d.error); return; }
      apply(d);
      // the saved copy is on screen; check Gmail for anything newer
      if (d.saved) {
        fetch(`/api/email/thread?id=${encodeURIComponent(id)}&fresh=1`).then((r) => r.json()).then((f) => {
          if (alive && !f.error && (f.messages.length !== d.messages.length || f.thread.unread !== d.thread.unread)) apply({ ...f, thread: { ...f.thread, category: f.thread.category || d.thread.category } });
        }).catch(() => {});
      }
    }).catch(() => alive && setErr('Could not load this conversation.'));
    return () => { alive = false; };
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (op, msg, leave) => {
    setBusy(true);
    const r = await post({ action: 'modify', threadId: id, op });
    setBusy(false);
    if (r.error) { onFlash(`Could not do that: ${r.error}`); return; }
    setData((d) => (d ? { ...d, thread: { ...d.thread, ...r.thread, category: d.thread.category } } : d));
    onChanged(id, r.thread, op);
    onFlash(msg);
    if (leave) onBack();
  };

  if (err) return <div className="p-6 text-[14px]" style={{ color: C.red }}>{err}</div>;
  if (!data) return <ConversationSkeleton onBack={onBack} />;
  const t = data.thread;
  const lastMsg = data.messages[data.messages.length - 1];
  const lastIn = [...data.messages].reverse().find((m) => !m.sentByUs) || lastMsg;
  return (
    <div>
      <div className="flex items-center gap-1 px-2 h-12" style={{ borderBottom: `1px solid ${C.line}` }}>
        <IconBtn icon="back" title="Back" onClick={onBack} />
        {t.inInbox
          ? <IconBtn icon="archive" title="Archive" disabled={busy} onClick={() => act('archive', 'Conversation archived.', folder === 'inbox')} />
          : <IconBtn icon="unarchive" title="Move to Inbox" disabled={busy} onClick={() => act('inbox', 'Conversation moved to Inbox.')} />}
        <IconBtn icon="spam" title="Report spam" disabled={busy} onClick={() => act('spam', 'Conversation marked as spam.', true)} />
        <IconBtn icon="trash" title="Delete" disabled={busy} onClick={() => act('trash', 'Conversation moved to Trash.', true)} />
        <span className="w-px h-5 mx-1" style={{ background: C.line }} />
        <button type="button" disabled={busy} onClick={() => (t.unread ? act('read', 'Marked as read.') : act('unread', 'Marked as unread.'))}
          className="inline-flex items-center gap-2 h-8 pl-2.5 pr-3.5 rounded-full text-[13px] font-medium hover:bg-black/[.05] disabled:opacity-40"
          style={{ border: `1px solid ${C.line}`, color: C.sub }} title={t.unread ? 'Mark as read once it is handled' : 'Keep it as still to do'}>
          <Icon d={t.unread ? 'markRead' : 'markUnread'} size={17} /> {t.unread ? 'Mark as read' : 'Mark as unread'}
        </button>
        <span className="ml-auto mr-2 text-[12px] font-medium px-2.5 py-1 rounded-full" style={t.unread ? { background: '#FEEFC3', color: '#7A4F01' } : { background: C.hover, color: C.sub }}>
          {t.unread ? 'Unread' : 'Read'}
        </span>
      </div>
      <div className="flex items-start gap-3 sm:pl-[68px] pl-4 pr-4 pt-5 pb-3">
        <h1 className="text-[22px] leading-snug flex-1" style={{ color: C.text }}>
          {t.subject || '(no subject)'}
          {t.category && <span className="align-middle ml-2"><Chip cat={t.category} /></span>}
          {t.inInbox && <span className="align-middle text-[12px] px-1.5 py-[3px] rounded ml-0.5" style={{ background: C.hover, color: C.sub }}>Inbox</span>}
        </h1>
        <IconBtn icon={t.starred ? 'star' : 'starOutline'} title={t.starred ? 'Starred' : 'Not starred'} color={t.starred ? C.star : C.sub} onClick={() => act(t.starred ? 'unstar' : 'star', t.starred ? 'Star removed.' : 'Starred.')} />
      </div>
      <div>
        {data.messages.map((m) => (
          <Message key={m.id} m={m} open={!!open[m.id]} onToggle={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} onReply={(mode, msg) => setReply({ mode, msg })}
            unread={t.unread} onReadToggle={() => (t.unread ? act('read', 'Marked as read.') : act('unread', 'Marked as unread.'))} onSender={onSender} />
        ))}
      </div>
      <div className="pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
        {reply
          ? <ReplyBox key={`${reply.mode}-${reply.msg.id}`} mode={reply.mode} msg={reply.msg} thread={t} onClose={() => setReply(null)}
              onSent={(msg) => {
                const wasReply = reply.mode !== 'forward';
                setReply(null); onFlash(msg); fresh(data);
                if (wasReply) onChanged(id, { unread: false }, 'read');
              }} />
          : (
            <div className="flex flex-wrap gap-2 sm:pl-[68px] pl-4 pr-4 pb-6 pt-2">
              {[['reply', 'Reply'], ['replyAll', 'Reply all'], ['forward', 'Forward']].map(([mode, label]) => (
                <button key={mode} type="button" onClick={() => setReply({ mode, msg: mode === 'forward' ? lastMsg : lastIn })}
                  className="inline-flex items-center gap-2 h-9 px-5 rounded-full text-[14px] font-medium hover:bg-black/[.04]" style={{ border: `1px solid ${C.faint}`, color: C.sub }}>
                  <Icon d={mode} size={18} /> {label}
                </button>
              ))}
            </div>
          )}
      </div>
    </div>
  );
}

// ── "New Message" window, bottom right ──
function Compose({ onClose, onSent }) {
  const [to, setTo] = useState(''); const [subject, setSubject] = useState(''); const [text, setText] = useState('');
  const [min, setMin] = useState(false); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const send = async () => {
    setBusy(true); setErr('');
    const r = await post({ action: 'send', to, subject, text });
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    onSent();
  };
  return (
    <div className="fixed bottom-0 right-4 sm:right-16 z-[250] w-[calc(100%-2rem)] sm:w-[540px] rounded-t-xl overflow-hidden shadow-[0_8px_10px_1px_rgba(0,0,0,.14),0_3px_14px_2px_rgba(0,0,0,.12)]" style={{ background: C.card }}>
      <div className="flex items-center justify-between px-4 h-10 cursor-pointer" style={{ background: C.readRow }} onClick={() => setMin((v) => !v)}>
        <span className="text-[14px] font-medium" style={{ color: C.text }}>New Message</span>
        <button type="button" aria-label="Close" onClick={(e) => { e.stopPropagation(); onClose(); }} style={{ color: C.sub }}><Icon d="close" size={18} /></button>
      </div>
      {!min && (
        <div>
          <div className="px-4 text-[14px] flex items-center" style={{ borderBottom: `1px solid ${C.line}` }}>
            <span style={{ color: C.muted }}>From</span><span className="ml-3 py-2" style={{ color: C.text }}>Casa-Libre &lt;info@casa-libre.com&gt;</span>
          </div>
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="To" autoFocus className="w-full px-4 py-2 outline-none text-[14px]" style={{ borderBottom: `1px solid ${C.line}`, color: C.text }} />
          <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject" className="w-full px-4 py-2 outline-none text-[14px]" style={{ borderBottom: `1px solid ${C.line}`, color: C.text }} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="w-full px-4 py-3 outline-none text-[14px] resize-none" style={{ color: C.text }} />
          {err && <p className="px-4 pb-2 text-[12.5px]" style={{ color: C.red }}>{err}</p>}
          <div className="flex items-center justify-between px-4 pb-3">
            <button type="button" onClick={send} disabled={busy || !to || !subject || !text}
              className="px-6 h-9 rounded-full text-[14px] font-medium text-white disabled:opacity-50" style={{ background: C.blue }}>{busy ? 'Sending…' : 'Send'}</button>
            <IconBtn icon="trash" title="Discard draft" onClick={onClose} size={18} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Mail settings (gear): Forwarding + Sidebar badge ──
const SETTINGS_TABS = [
  { key: 'forwarding', name: 'Forwarding', icon: 'forward', sub: 'Who gets which emails' },
  { key: 'badge', name: 'Sidebar badge', icon: 'markUnread', sub: 'What the unread number counts' },
];

// A type as an on/off pill: filled in the type's colour when on.
function TypeToggle({ cat, on, onClick, count }) {
  const c = CATEGORIES[cat]; const col = CAT_COLORS[cat];
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick}
      className="inline-flex items-center gap-1.5 h-8 pl-2 pr-3 rounded-full text-[13px] font-medium transition-colors"
      style={on ? { background: col.bg, color: col.fg, border: `1px solid ${col.bg}` } : { background: C.card, color: C.muted, border: `1px solid ${C.line}` }}>
      <span className="h-4 w-4 rounded-full inline-flex items-center justify-center" style={{ background: on ? col.fg : 'transparent', border: on ? 'none' : `1.5px solid ${C.faint}` }}>
        {on && <svg width="10" height="10" viewBox="0 0 24 24" fill="#fff" aria-hidden="true"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" /></svg>}
      </span>
      {c.name}{count != null ? <span className="opacity-70">· {count}</span> : null}
    </button>
  );
}

function MailSettings({ onClose, counts = {}, onSaved }) {
  const [tab, setTab] = useState('forwarding');
  const [rules, setRules] = useState(null);
  const [badge, setBadge] = useState(['important']);
  const [meta, setMeta] = useState({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  useEffect(() => {
    fetch('/api/email/settings').then((r) => r.json()).then((d) => { setRules(d.rules || []); setBadge(d.badge || ['important']); setMeta(d); }).catch(() => setErr('Could not load the settings.'));
  }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
  const touch = () => { setDirty(true); setOk(''); setErr(''); };
  const setRule = (i, patch) => { touch(); setRules((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r))); };
  const toggleRule = (i, k) => setRule(i, { categories: rules[i].categories.includes(k) ? rules[i].categories.filter((x) => x !== k) : [...rules[i].categories, k] });
  const toggleBadge = (k) => { touch(); setBadge((b) => (b.includes(k) ? b.filter((x) => x !== k) : [...b, k])); };
  const badgeTotal = badge.reduce((n, k) => n + (Number(counts[k]) || 0), 0);
  const bad = (rules || []).filter((r) => r.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim()));

  const save = async () => {
    if (bad.length) { setErr(`Check this address: ${bad[0].email}`); setTab('forwarding'); return; }
    setBusy(true); setErr(''); setOk('');
    const r = await fetch('/api/email/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules: rules.filter((x) => x.email.trim()), badge }) }).then((x) => x.json()).catch(() => ({ error: 'Could not save. Try again.' }));
    setBusy(false);
    if (r.error) { setErr(r.error); return; }
    setRules(r.rules); setBadge(r.badge); setMeta(r); setDirty(false); setOk('Settings saved.');
    onSaved?.();
  };

  return (
    <div className="fixed inset-0 z-[300] flex items-start sm:items-center justify-center p-3 sm:p-6 overflow-y-auto" style={{ background: 'rgba(32,33,36,.45)' }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="mail-settings-title" className="w-full max-w-[880px] rounded-2xl overflow-hidden flex flex-col shadow-[0_24px_38px_3px_rgba(0,0,0,.14),0_9px_46px_8px_rgba(0,0,0,.12)]" style={{ background: C.card, maxHeight: 'calc(100vh - 48px)' }}>
        {/* header */}
        <div className="flex items-center justify-between pl-6 pr-3 h-16 shrink-0" style={{ borderBottom: `1px solid ${C.line}` }}>
          <div>
            <h2 id="mail-settings-title" className="text-[18px] font-medium" style={{ color: C.text }}>Mail settings</h2>
            <p className="text-[12px]" style={{ color: C.muted }}>info@casa-libre.com · shared by the whole team</p>
          </div>
          <IconBtn icon="close" title="Close" onClick={onClose} />
        </div>

        <div className="flex flex-col sm:flex-row min-h-0 flex-1">
          {/* left: sections */}
          <nav className="sm:w-[220px] shrink-0 p-2 sm:p-3 flex sm:flex-col gap-1 overflow-x-auto" style={{ background: C.page, borderRight: `1px solid ${C.line}` }}>
            {SETTINGS_TABS.map((t) => {
              const on = tab === t.key;
              return (
                <button key={t.key} type="button" onClick={() => setTab(t.key)} className="text-left flex items-start gap-3 px-3 py-2.5 rounded-xl shrink-0 transition-colors"
                  style={{ background: on ? C.sel : 'transparent', color: on ? C.selText : C.text }}>
                  <span className="mt-0.5"><Icon d={t.icon} size={18} color={on ? C.selText : C.sub} /></span>
                  <span>
                    <span className="block text-[14px] font-medium">{t.name}</span>
                    <span className="hidden sm:block text-[11.5px]" style={{ color: on ? C.selText : C.muted, opacity: 0.85 }}>{t.sub}</span>
                  </span>
                </button>
              );
            })}
          </nav>

          {/* right: the section */}
          <div className="flex-1 min-w-0 overflow-y-auto p-6">
            {rules === null ? (
              <div className="animate-pulse space-y-3" role="status" aria-label="Loading settings">
                {[70, 95, 95, 60].map((w, i) => <div key={i} className="h-4 rounded" style={{ background: C.hover, width: `${w}%` }} />)}
              </div>
            ) : tab === 'forwarding' ? (
              <section>
                <h3 className="text-[15px] font-medium" style={{ color: C.text }}>Forward new emails to the team</h3>
                <p className="text-[13px] mt-1 mb-5" style={{ color: C.muted }}>Each new email is sent on once, when it arrives, to every address whose types match, with a link to answer it from info@. Older emails are never forwarded.</p>

                <div className="rounded-xl overflow-hidden" style={{ border: `1px solid ${C.line}` }}>
                  <div className="hidden md:grid grid-cols-[minmax(0,1fr)_auto_40px] gap-4 px-4 py-2 text-[11.5px] font-medium" style={{ background: C.page, color: C.muted, borderBottom: `1px solid ${C.line}` }}>
                    <span>Recipient</span><span>Gets these types</span><span />
                  </div>
                  {rules.length === 0 && (
                    <div className="px-4 py-8 text-center">
                      <p className="text-[14px]" style={{ color: C.text }}>Nobody gets forwarded emails yet.</p>
                      <p className="text-[12.5px] mt-1" style={{ color: C.muted }}>Add a recipient to send important emails to the team as they arrive.</p>
                    </div>
                  )}
                  {rules.map((r, i) => {
                    const invalid = r.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(r.email.trim());
                    return (
                      <div key={i} className="grid md:grid-cols-[minmax(0,1fr)_auto_40px] gap-3 md:gap-4 items-center px-4 py-3" style={{ borderTop: i ? `1px solid ${C.line}` : 'none' }}>
                        <div>
                          <div className="flex items-center gap-2 h-10 px-3 rounded-lg" style={{ border: `1px solid ${invalid ? C.red : C.faint}` }}>
                            <Icon d="other" size={16} color={C.muted} />
                            <input className="flex-1 min-w-0 outline-none text-[14px] bg-transparent" style={{ color: C.text }} placeholder="name@example.com" value={r.email}
                              onChange={(e) => setRule(i, { email: e.target.value })} aria-label="Recipient email address" aria-invalid={!!invalid} />
                          </div>
                          {invalid && <p className="text-[11.5px] mt-1" style={{ color: C.red }}>This doesn&apos;t look like an email address.</p>}
                          {r.categories.length === 0 && !invalid && <p className="text-[11.5px] mt-1" style={{ color: C.muted }}>No type chosen: this address gets nothing.</p>}
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {CATEGORY_KEYS_UI.map((k) => <TypeToggle key={k} cat={k} on={r.categories.includes(k)} onClick={() => toggleRule(i, k)} />)}
                        </div>
                        <IconBtn icon="trash" title="Remove recipient" size={18} onClick={() => { touch(); setRules((rs) => rs.filter((_, j) => j !== i)); }} />
                      </div>
                    );
                  })}
                </div>
                <button type="button" onClick={() => { touch(); setRules((rs) => [...rs, { email: '', categories: ['important'] }]); }}
                  className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-full text-[14px] font-medium hover:bg-black/[.04]" style={{ color: C.blue, border: `1px solid ${C.line}` }}>
                  <span className="text-[18px] leading-none">+</span> Add recipient
                </button>

                <h4 className="text-[13px] font-medium mt-7 mb-2" style={{ color: C.text }}>What goes in each type</h4>
                <div className="grid sm:grid-cols-2 gap-2">
                  {CATEGORY_KEYS_UI.map((k) => (
                    <div key={k} className="flex gap-2.5 p-3 rounded-xl" style={{ background: C.page }}>
                      <span className="h-2.5 w-2.5 rounded-full mt-1.5 shrink-0" style={{ background: CAT_COLORS[k].fg }} />
                      <span className="text-[12.5px]" style={{ color: C.sub }}><b style={{ color: C.text }}>{CATEGORIES[k].name}.</b> {CATEGORIES[k].help}</span>
                    </div>
                  ))}
                </div>
              </section>
            ) : (
              <section>
                <h3 className="text-[15px] font-medium" style={{ color: C.text }}>Unread number in the sidebar</h3>
                <p className="text-[13px] mt-1 mb-5" style={{ color: C.muted }}>Choose which types count in the number next to <b style={{ color: C.text }}>Email (info@)</b> in the admin sidebar, like the WhatsApp Inbox badge. An email counts until it&apos;s marked as read (handled).</p>

                <div className="grid sm:grid-cols-2 gap-3">
                  {CATEGORY_KEYS_UI.map((k) => {
                    const on = badge.includes(k);
                    const col = CAT_COLORS[k];
                    return (
                      <button key={k} type="button" role="switch" aria-checked={on} onClick={() => toggleBadge(k)}
                        className="text-left flex items-start gap-3 p-4 rounded-xl transition-colors"
                        style={{ border: `1.5px solid ${on ? col.fg : C.line}`, background: on ? col.bg : C.card }}>
                        <span className="mt-0.5 h-5 w-9 rounded-full relative shrink-0 transition-colors" style={{ background: on ? col.fg : '#C4C7C5' }}>
                          <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all" style={{ left: on ? 18 : 2 }} />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="flex items-baseline justify-between gap-2">
                            <span className="text-[14px] font-medium" style={{ color: on ? col.fg : C.text }}>{CATEGORIES[k].name}</span>
                            <span className="text-[12px]" style={{ color: on ? col.fg : C.muted }}>{Number(counts[k]) || 0} unread</span>
                          </span>
                          <span className="block text-[12px] mt-0.5" style={{ color: C.muted }}>{CATEGORIES[k].help}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <h4 className="text-[13px] font-medium mt-7 mb-2" style={{ color: C.text }}>Preview</h4>
                <div className="inline-flex items-center gap-3 pl-3.5 pr-3 py-2.5 rounded-[10px] min-w-[240px]" style={{ background: '#111111', color: '#FAF7F1' }}>
                  <Icon d="other" size={18} color="#FAF7F1" />
                  <span className="text-[14px] font-medium flex-1">Email (info@)</span>
                  {badge.length && badgeTotal ? <span className="text-[11px] font-bold min-w-[20px] h-5 px-1.5 rounded-full inline-flex items-center justify-center" style={{ background: '#E5484D', color: '#fff' }}>{badgeTotal}</span> : null}
                </div>
                <p className="text-[12px] mt-2" style={{ color: C.muted }}>
                  {badge.length === 0 ? 'No type chosen: the sidebar shows no number for Email.' : `Counts unread ${badge.map((k) => CATEGORIES[k].name).join(', ')} emails.`}
                </p>
              </section>
            )}
          </div>
        </div>

        {/* footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 shrink-0" style={{ borderTop: `1px solid ${C.line}`, background: C.card }}>
          <span className="text-[12px]" style={{ color: err ? C.red : ok ? '#146C2E' : C.muted }} role="status">
            {err || ok || (dirty ? 'Unsaved changes' : meta.saved ? `Last saved ${new Date(meta.updatedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${meta.updatedBy ? ` by ${meta.updatedBy}` : ''}` : 'Not saved yet: important emails go to the default address, and the badge counts Important.')}
          </span>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="h-9 px-5 rounded-full text-[14px] font-medium hover:bg-black/[.04]" style={{ color: C.blue }}>{dirty ? 'Cancel' : 'Close'}</button>
            <button type="button" onClick={save} disabled={busy || rules === null || !dirty}
              className="h-9 px-6 rounded-full text-[14px] font-medium text-white disabled:opacity-40" style={{ background: C.blue }}>{busy ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// A thin moving bar under the toolbar while a folder loads or Gmail is checked.
function ProgressBar({ on }) {
  return (
    <div className="relative h-[3px] overflow-hidden" style={{ background: on ? '#D3E3FD' : 'transparent' }} aria-hidden="true">
      {on && <div className="absolute inset-y-0 w-1/3 rounded-full" style={{ background: C.blue, animation: 'clMailBar 1.1s ease-in-out infinite' }} />}
      <style>{'@keyframes clMailBar{0%{left:-35%}100%{left:100%}}@media (prefers-reduced-motion: reduce){[style*="clMailBar"]{animation:none!important;left:0!important;width:100%!important;opacity:.5}}'}</style>
    </div>
  );
}

// Grey placeholder rows in the shape of the list while it loads.
function SkeletonRows({ n = 9 }) {
  return (
    <div aria-label="Loading conversations" role="status" style={{ borderTop: `1px solid ${C.line}` }}>
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="flex items-center h-10 pl-4 pr-4 gap-4 animate-pulse" style={{ borderBottom: `1px solid ${C.line}` }}>
          <span className="h-4 w-4 rounded-sm" style={{ background: C.hover }} />
          <span className="h-4 w-4 rounded-full" style={{ background: C.hover }} />
          <span className="h-3 rounded" style={{ background: C.hover, width: 140 }} />
          <span className="h-3 rounded flex-1" style={{ background: C.hover, maxWidth: `${55 + ((i * 17) % 35)}%` }} />
          <span className="h-3 w-12 rounded ml-auto" style={{ background: C.hover }} />
        </div>
      ))}
    </div>
  );
}

function ConversationSkeleton({ onBack }) {
  return (
    <div role="status" aria-label="Loading the conversation">
      <div className="flex items-center gap-1 px-2 h-12" style={{ borderBottom: `1px solid ${C.line}` }}><IconBtn icon="back" title="Back" onClick={onBack} /></div>
      <ProgressBar on />
      <div className="animate-pulse sm:pl-[68px] pl-4 pr-6 pt-6">
        <div className="h-6 rounded w-2/3 mb-6" style={{ background: C.hover }} />
        <div className="flex items-center gap-3 mb-5">
          <span className="h-10 w-10 rounded-full" style={{ background: C.hover }} />
          <div className="flex-1"><div className="h-3 rounded w-48 mb-2" style={{ background: C.hover }} /><div className="h-3 rounded w-24" style={{ background: C.hover }} /></div>
        </div>
        {[92, 85, 88, 60].map((w, i) => <div key={i} className="h-3 rounded mb-3" style={{ background: C.hover, width: `${w}%` }} />)}
      </div>
    </div>
  );
}

const PAGE = 50;

function Mailbox() {
  const sp = useSearchParams();
  const [folder, setFolder] = useState('important');   // Important opens first
  const [qIn, setQIn] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [threads, setThreads] = useState(null);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState({});
  const [err, setErr] = useState('');
  const [openId, setOpenId] = useState(sp.get('thread') || null);
  const [checked, setChecked] = useState(new Set());
  const [syncing, setSyncing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [syncedAt, setSyncedAt] = useState(null);
  const [compose, setCompose] = useState(false);
  const [fwd, setFwd] = useState(false);
  const [flash, setFlash] = useState('');
  const flashT = useRef(null);
  const showFlash = (m) => { setFlash(m); clearTimeout(flashT.current); flashT.current = setTimeout(() => setFlash(''), 4000); };

  // the saved copy (instant)
  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!quiet) { setErr(''); setLoading(true); }
    const qs = new URLSearchParams({ view: folder, q, page: String(page) });
    const d = await fetch(`/api/email?${qs}`).then((r) => r.json()).catch(() => ({ error: 'Could not load the mailbox.' }));
    if (!quiet) setLoading(false);
    if (d.error) { if (!quiet) { setErr(d.error === 'not_connected' ? 'The info@ mailbox is not connected.' : d.error); setThreads((t) => t || []); } return null; }
    setThreads(d.threads); setTotal(d.total || 0); setCounts(d.counts || {});
    return d;
  }, [folder, q, page]);

  // Gmail → saved copy (background), then show the update
  const sync = useCallback(async () => {
    setSyncing(true);
    await fetch('/api/email/sync', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ view: folder, q }) }).catch(() => {});
    setSyncing(false); setSyncedAt(new Date());
    await load({ quiet: true });
  }, [folder, q, load]);

  useEffect(() => { setChecked(new Set()); load().then(() => { if (page === 0) sync(); }); }, [load]); // eslint-disable-line react-hooks/exhaustive-deps
  // new mail: the saved copy every 30 s (the Gmail script pushes each minute), Gmail itself every 3 min
  useEffect(() => {
    const a = setInterval(() => { if (document.visibilityState === 'visible') load({ quiet: true }); }, 30_000);
    const b = setInterval(() => { if (document.visibilityState === 'visible') sync(); }, 180_000);
    return () => { clearInterval(a); clearInterval(b); };
  }, [load, sync]);

  const showSender = (email) => { setFolder('all'); setPage(0); setOpenId(null); setQ(email); setQIn(email); setThreads(null); setChecked(new Set()); setLoading(true); };
  const goFolder = (k) => { if (k === folder && !openId) return; setFolder(k); setPage(0); setOpenId(null); setQ(''); setQIn(''); setThreads(null); setChecked(new Set()); setLoading(true); };
  const runSearch = () => { setPage(0); setOpenId(null); setQ(qIn.trim()); };

  const leaves = (op) => ({ archive: folder === 'inbox', spam: folder !== 'spam', trash: folder !== 'trash', notspam: folder === 'spam', inbox: folder === 'trash' || folder === 'spam' }[op]);
  const onChanged = (id, patch, op) => {
    if (['read', 'unread', 'spam', 'notspam', 'trash', 'inbox', 'archive'].includes(op)) refreshUnread();
    setThreads((cur) => (cur || []).flatMap((t) => (t.id !== id ? [t] : leaves(op) ? [] : [{ ...t, ...patch, category: t.category }])));
    if (leaves(op)) setTotal((n) => Math.max(0, n - 1));
    load({ quiet: true });
  };

  const bulk = async (op, msg) => {
    const ids = [...checked];
    setChecked(new Set());
    for (const id of ids) {
      const r = await post({ action: 'modify', threadId: id, op });
      if (!r.error) onChanged(id, r.thread, op);
    }
    showFlash(`${ids.length} conversation${ids.length === 1 ? '' : 's'} ${msg}.`);
  };
  const rowAct = async (e, t, op, msg) => {
    e.stopPropagation();
    const r = await post({ action: 'modify', threadId: t.id, op });
    if (r.error) { showFlash(`Could not do that: ${r.error}`); return; }
    onChanged(t.id, r.thread, op);
    if (msg) showFlash(msg);
  };

  const list = threads || [];
  const allChecked = list.length > 0 && list.every((t) => checked.has(t.id));
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min(total, page * PAGE + list.length);
  const someChecked = checked.size > 0;
  const checkedUnread = list.filter((t) => checked.has(t.id)).some((t) => t.unread);

  return (
    <div className="-mx-5 md:-mx-8 -my-8 min-h-screen p-2 sm:p-3" style={{ background: C.page }}>
      {/* top bar: search + settings */}
      <div className="flex items-center gap-3 mb-2">
        <div className="hidden md:flex items-center w-[244px] pl-4">
          <span className="text-[22px]" style={{ color: C.sub }}>info@ mail</span>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); runSearch(); }} className="flex-1 max-w-[720px] flex items-center h-12 rounded-full px-2" style={{ background: C.search }}>
          <IconBtn icon="search" title="Search" onClick={runSearch} />
          <input value={qIn} onChange={(e) => { setQIn(e.target.value); if (!e.target.value && q) { setQ(''); setPage(0); } }} placeholder="Search mail" className="flex-1 bg-transparent outline-none text-[16px]" style={{ color: C.text }} />
          {qIn && <IconBtn icon="close" title="Clear search" onClick={() => { setQIn(''); setQ(''); setPage(0); }} />}
        </form>
        <div className="ml-auto flex items-center gap-1">
          <span className="hidden sm:inline text-[12px] mr-1" style={{ color: C.muted }}>{syncing ? 'Checking Gmail…' : syncedAt ? `Up to date · ${syncedAt.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
          <IconBtn icon="gear" title="Mail settings" onClick={() => setFwd(true)} />
        </div>
      </div>

      <div className="flex gap-2">
        {/* left: compose + folders */}
        <aside className="hidden md:block w-[244px] shrink-0">
          <button type="button" onClick={() => setCompose(true)} className="flex items-center gap-3 h-14 pl-4 pr-6 rounded-2xl mb-3 hover:shadow-[0_1px_3px_rgba(0,0,0,.3)] transition-shadow" style={{ background: C.compose, color: C.text }}>
            <Icon d="pencil" size={22} /> <span className="text-[14px] font-medium">Compose</span>
          </button>
          <nav>
            {FOLDERS.map((f) => {
              const on = folder === f.key;
              const n = counts[f.key];
              return (
                <button key={f.key} type="button" onClick={() => goFolder(f.key)} className="w-full flex items-center gap-4 h-8 pl-6 pr-4 rounded-r-full text-[14px] hover:bg-black/[.04]"
                  style={{ background: on ? C.sel : undefined, color: on ? C.selText : C.text, fontWeight: on || n ? 700 : 400 }}>
                  <Icon d={f.icon} size={18} color={on ? C.selText : C.sub} />
                  <span className="flex-1 text-left">{f.name}</span>
                  {n ? <span className="text-[12px]">{n}</span> : null}
                </button>
              );
            })}
          </nav>
        </aside>

        {/* right: the list, or one conversation */}
        <main className="flex-1 min-w-0 rounded-2xl overflow-hidden" style={{ background: C.card, minHeight: 'calc(100vh - 90px)' }}>
          <div className="md:hidden flex items-center gap-2 p-2" style={{ borderBottom: `1px solid ${C.line}` }}>
            <select value={folder} onChange={(e) => goFolder(e.target.value)} className="flex-1 h-9 px-2 rounded-md text-[14px]" style={{ border: `1px solid ${C.line}` }}>
              {FOLDERS.map((f) => <option key={f.key} value={f.key}>{f.name}{counts[f.key] ? ` (${counts[f.key]})` : ''}</option>)}
            </select>
            <button type="button" onClick={() => setCompose(true)} className="h-9 px-4 rounded-xl text-[14px] font-medium" style={{ background: C.compose }}>Compose</button>
          </div>

          {openId ? (
            <Conversation key={openId} id={openId} folder={folder} onBack={() => setOpenId(null)} onChanged={onChanged} onFlash={showFlash} onSender={showSender} />
          ) : (
            <>
              <div className="flex items-center gap-1 px-2 h-12">
                <label className="h-10 w-10 inline-flex items-center justify-center rounded-full hover:bg-black/[.06] cursor-pointer" title="Select">
                  <input type="checkbox" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(list.map((t) => t.id)))} className="h-4 w-4" />
                </label>
                {someChecked ? (
                  <>
                    {folder === 'trash' || folder === 'spam'
                      ? <IconBtn icon="unarchive" title="Move to Inbox" onClick={() => bulk(folder === 'spam' ? 'notspam' : 'inbox', 'moved to Inbox')} />
                      : <IconBtn icon="archive" title="Archive" onClick={() => bulk('archive', 'archived')} />}
                    {folder !== 'spam' && <IconBtn icon="spam" title="Report spam" onClick={() => bulk('spam', 'marked as spam')} />}
                    {folder !== 'trash' && <IconBtn icon="trash" title="Delete" onClick={() => bulk('trash', 'moved to Trash')} />}
                    <span className="w-px h-5 mx-1" style={{ background: C.line }} />
                    {checkedUnread
                      ? <IconBtn icon="markRead" title="Mark as read" onClick={() => bulk('read', 'marked as read')} />
                      : <IconBtn icon="markUnread" title="Mark as unread" onClick={() => bulk('unread', 'marked as unread')} />}
                  </>
                ) : (
                  <IconBtn icon="refresh" title="Refresh" onClick={() => { load(); sync(); }} />
                )}
                <div className="ml-auto flex items-center text-[12px]" style={{ color: C.muted }}>
                  <span className="mr-2">{total ? `${from}–${to} of ${total.toLocaleString('en-US')}` : ''}</span>
                  <IconBtn icon="left" title="Newer" disabled={page === 0} onClick={() => setPage((p) => Math.max(0, p - 1))} size={18} />
                  <IconBtn icon="right" title="Older" disabled={to >= total} onClick={() => setPage((p) => p + 1)} size={18} />
                </div>
              </div>

              <ProgressBar on={loading || syncing} />
              {err && <p className="px-6 py-3 text-[14px]" style={{ color: C.red }}>{err}</p>}
              {(threads === null || (loading && !list.length)) && <SkeletonRows />}
              {threads && !loading && list.length === 0 && !err && (
                <p className="px-6 py-10 text-center text-[14px]" style={{ color: C.muted }}>{q ? 'No messages matched your search.' : syncing ? 'Checking Gmail…' : 'No conversations here.'}</p>
              )}

              <div style={{ borderTop: list.length ? `1px solid ${C.line}` : 'none', opacity: loading && list.length ? 0.5 : 1, transition: 'opacity .15s' }}>
                {list.map((t) => {
                  const on = checked.has(t.id);
                  const bold = t.unread ? 700 : 400;
                  return (
                    <div key={t.id} role="button" tabIndex={0} onClick={() => setOpenId(t.id)} onKeyDown={(e) => { if (e.key === 'Enter') setOpenId(t.id); }}
                      className="group relative flex items-center h-10 pl-2 pr-4 cursor-pointer hover:z-10 hover:shadow-[inset_1px_0_0_#dadce0,inset_-1px_0_0_#dadce0,0_1px_2px_0_rgba(60,64,67,.3),0_1px_3px_1px_rgba(60,64,67,.15)]"
                      style={{ background: on ? '#C2DBFF' : t.unread ? C.card : C.readRow, borderBottom: `1px solid ${C.line}` }}>
                      <label className="h-10 w-9 inline-flex items-center justify-center shrink-0" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={on} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(t.id)) n.delete(t.id); else n.add(t.id); return n; })} className="h-4 w-4" />
                      </label>
                      <button type="button" className="h-10 w-8 inline-flex items-center justify-center shrink-0" title={t.starred ? 'Starred' : 'Not starred'} onClick={(e) => rowAct(e, t, t.starred ? 'unstar' : 'star')}>
                        <Icon d={t.starred ? 'star' : 'starOutline'} size={20} color={t.starred ? C.star : '#BDC1C6'} />
                      </button>
                      <span className="w-[110px] sm:w-[200px] shrink-0 truncate pl-2 pr-4 text-[14px]" style={{ color: C.text, fontWeight: bold }}>
                        {shortName(t.lastFrom)}{t.count > 1 ? <span className="font-normal" style={{ color: C.muted }}> {t.count}</span> : null}
                      </span>
                      <span className="flex-1 min-w-0 flex items-center text-[14px]">
                        {t.category && folder !== t.category && <Chip cat={t.category} />}
                        <span className="truncate">
                          <span style={{ color: C.text, fontWeight: bold }}>{t.subject || '(no subject)'}</span>
                          {t.snippet ? <span style={{ color: C.muted }}> - {t.snippet}</span> : null}
                        </span>
                      </span>
                      {t.hasAttachments && <span className="ml-2 shrink-0"><Icon d="clip" size={16} color={C.muted} /></span>}
                      <span className="w-[72px] text-right shrink-0 text-[12px] group-hover:hidden" style={{ color: t.unread ? C.text : C.muted, fontWeight: bold }}>{listDate(t.lastDate)}</span>
                      <span className="hidden group-hover:flex items-center shrink-0 -mr-2">
                        {folder !== 'trash' && <IconBtn icon={t.inInbox ? 'archive' : 'unarchive'} title={t.inInbox ? 'Archive' : 'Move to Inbox'} size={18} onClick={(e) => rowAct(e, t, t.inInbox ? 'archive' : 'inbox', t.inInbox ? 'Conversation archived.' : 'Moved to Inbox.')} />}
                        {folder !== 'trash' && <IconBtn icon="trash" title="Delete" size={18} onClick={(e) => rowAct(e, t, 'trash', 'Conversation moved to Trash.')} />}
                        <IconBtn icon={t.unread ? 'markRead' : 'markUnread'} title={t.unread ? 'Mark as read' : 'Mark as unread'} size={18} onClick={(e) => rowAct(e, t, t.unread ? 'read' : 'unread')} />
                      </span>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </main>
      </div>

      {flash && <div className="fixed bottom-6 left-6 z-[260] px-6 py-3.5 rounded text-[14px] text-white shadow-lg" style={{ background: '#323232' }}>{flash}</div>}
      {compose && <Compose onClose={() => setCompose(false)} onSent={() => { setCompose(false); showFlash('Message sent.'); if (folder === 'sent') sync(); }} />}
      {fwd && <MailSettings onClose={() => setFwd(false)} counts={counts} onSaved={() => refreshUnread()} />}
    </div>
  );
}

export default function EmailPage() {
  return <Suspense fallback={null}><Mailbox /></Suspense>;
}
