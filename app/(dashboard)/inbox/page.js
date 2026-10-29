'use client';
// Inbox — the Casa Libre WhatsApp conversations, the same inbox as in Relay (kept in sync
// with it). Built so no message is left without an answer:
//   • per site (the switcher's country, or All): one number serves every site; each
//     conversation shows under the site(s) whose verification code it got (tag site-xx,
//     lib/inboxRules.js) — a number used on two sites shows in both
//   • Everything, Unread (new messages or "Mark as unread") and Unresponded (the
//     contact wrote last) with counts
//   • the thread: ticks, media, template buttons, Translate (one message or all), "Reply with
//     AI" on a message, the contact's Casa Libre account → their activity page
//   • the reply: text / photo / file inside the 24h window, or an approved template outside
//     it; "Write with AI" drafts it (Claude, in the contact's language, English shown to us)
//   • Mark as unread (no "Mark as done": the dot is how the team knows to come back),
//     Do not contact (+ note), tags
// Live = the real number, Test keys = Relay's simulated traffic. Data: /api/inbox/* → Relay
// (lib/relayInbox.js). Refreshes itself every few seconds.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { T, Banner } from '@/components/automations/ui';
import { refreshUnread } from '@/components/unread';
import { formatPhone } from '@/lib/inboxRules';
import { WA_TEMPLATES } from '@/lib/whatsappTemplates';

const GREEN = '#0F6E4A';
const BUBBLE_OUT = '#D9FDD3';
const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador', none: 'No site yet' };
const siteNames = (sites = []) => sites.map((c) => COUNTRY_NAME[c] || String(c).toUpperCase()).join(' + ');
const initials = (c) => (c?.name ? c.name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() : null);
const timeOf = (iso) => (iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
function ago(iso) {
  if (!iso) return '';
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return 'now'; if (m < 60) return `${m}m`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
const dayLabel = (iso) => {
  const d = new Date(iso); const t = new Date();
  const same = (a, b) => a.toDateString() === b.toDateString();
  const y = new Date(); y.setDate(t.getDate() - 1);
  return same(d, t) ? 'Today' : same(d, y) ? 'Yesterday' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: d.getFullYear() === t.getFullYear() ? undefined : 'numeric' });
};
const TEMPLATE_LABEL = { casa_libre_otp: 'Verification code' };
// The button the person sees under a template (WhatsApp doesn't send it back to us).
const FIXED_BUTTON = { cl_pendiente_pago: 'Opens My listings', cl_fotos_rechazadas: 'Opens My listings', cl_publicacion_pausada: 'Opens My listings', cl_publicacion_incompleta: 'Opens My listings', casa_libre_otp: 'Copy code' };
const VAR_BUTTON = { property_url: 'Opens their listing', extend_url: 'Opens “extend my listing”', draft_url: 'Opens their draft' };
const buttonOf = (name, meta) => FIXED_BUTTON[name] || VAR_BUTTON[WA_TEMPLATES[name]?.button?.var] || (meta?.variables?.url_buttons?.length ? 'Link button' : null);

// WhatsApp *bold* / _italic_ / ~strike~ → elements (React escapes the rest).
function Rich({ text }) {
  const parts = String(text || '').split(/(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~)/g);
  return parts.map((p, i) => {
    if (/^\*[^*]+\*$/.test(p)) return <b key={i}>{p.slice(1, -1)}</b>;
    if (/^_[^_]+_$/.test(p)) return <i key={i}>{p.slice(1, -1)}</i>;
    if (/^~[^~]+~$/.test(p)) return <s key={i}>{p.slice(1, -1)}</s>;
    return <span key={i}>{p}</span>;
  });
}

function Ticks({ status }) {
  if (status === 'failed') return <span title="Failed — not delivered (e.g. not on WhatsApp). Not charged." style={{ color: T.danger, fontWeight: 700 }}>!</span>;
  if (status === 'read') return <span title="Read" style={{ color: '#34B7F1' }}>✓✓</span>;
  if (status === 'delivered') return <span title="Delivered" style={{ color: T.textMuted }}>✓✓</span>;
  if (status === 'sent') return <span title="Sent" style={{ color: T.textMuted }}>✓</span>;
  if (status === 'received') return null;
  return <span title={status || 'Queued'} style={{ color: T.textMuted }}>🕓</span>;
}

function Avatar({ c, size = 44 }) {
  const ini = initials(c);
  return (
    <div className="rounded-full flex items-center justify-center shrink-0 font-semibold" style={{ width: size, height: size, background: '#E4E1DA', color: T.textSecondary, fontSize: size * 0.34 }}>
      {ini || (
        <svg width={size * 0.42} height={size * 0.42} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /></svg>
      )}
    </div>
  );
}

function Media({ m, mode }) {
  const src = `/api/inbox/media/${m.id}?mode=${mode}`;
  const type = m.media?.type || m.type;
  if (type === 'image' || type === 'sticker') return <a href={src} target="_blank" rel="noreferrer">{/* eslint-disable-next-line @next/next/no-img-element */}<img src={src} alt="" className="rounded-[10px] max-w-[280px] max-h-[320px] object-cover mb-1" /></a>;
  if (type === 'audio') return <audio controls src={src} className="max-w-[260px] mb-1" />;
  if (type === 'video') return <video controls src={src} className="rounded-[10px] max-w-[280px] mb-1" />;
  return <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-2 px-3 py-2 rounded-[10px] mb-1 text-[13px] underline" style={{ background: 'rgba(0,0,0,.05)' }}>📄 {m.media?.filename || 'Document'}</a>;
}

function Bubble({ m, mode, english, onTranslate, onAiReply, tplMeta }) {
  const out = m.direction === 'outbound';
  const tplName = typeof m.template === 'string' ? m.template : m.template?.name;
  const created = m.timestamps?.created || m.created_at;
  const button = tplName ? buttonOf(tplName, tplMeta[tplName]) : null;
  return (
    <div className={`group flex ${out ? 'justify-end' : 'justify-start'} mb-2`} data-testid={`bubble-${m.direction}`}>
      <div className="max-w-[72%]">
        <div className="rounded-[12px] px-3 py-2 shadow-sm" style={{ background: out ? BUBBLE_OUT : '#fff' }}>
          {tplName && (
            <div className="text-[11.5px] font-semibold mb-0.5 flex items-center gap-1" style={{ color: GREEN }}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
              {TEMPLATE_LABEL[tplName] || tplName}<span className="font-normal" style={{ color: T.textMuted }}> · {m.sent_by === 'api' ? 'automatic' : m.sent_by || m.kind}</span>
            </div>
          )}
          {!tplName && out && m.sent_by && m.sent_by !== 'api' && <div className="text-[11px] mb-0.5" style={{ color: T.textMuted }}>{m.sent_by}</div>}
          {m.media && <Media m={m} mode={mode} />}
          {m.location && <a className="text-[13px] underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}`}>📍 {m.location.name || 'Location'}</a>}
          {m.text && <div className="text-[14px] whitespace-pre-wrap break-words" style={{ color: T.textPrimary }}><Rich text={m.text} /></div>}
          {english && english !== m.text && <div className="text-[12.5px] mt-1 pt-1 border-t italic whitespace-pre-wrap" style={{ color: T.textSecondary, borderColor: 'rgba(0,0,0,.08)' }} data-testid="translation">EN · {english}</div>}
          {!m.text && !m.media && !m.location && <div className="text-[13px] italic" style={{ color: T.textMuted }}>({m.type || 'message'})</div>}
          <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[11px]" style={{ color: T.textMuted }}>
            {m.error?.message && <span style={{ color: T.danger }} title={m.error.message}>failed</span>}
            {timeOf(created)}{out && <Ticks status={m.status} />}
          </div>
        </div>
        {button && (
          <div className="mt-1 rounded-[10px] px-3 py-1.5 text-center text-[12.5px] font-semibold shadow-sm" style={{ background: out ? BUBBLE_OUT : '#fff', color: '#027EB5' }} title="The button the person sees under this message" data-testid="template-button">↗ {button}</div>
        )}
        {m.text && (
          <div className={`flex gap-3 mt-0.5 text-[11.5px] opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity ${out ? 'justify-end' : 'justify-start'}`}>
            <button type="button" onClick={() => onTranslate(m)} className="underline underline-offset-2" style={{ color: T.textSecondary }}>{english ? 'Hide English' : 'Translate'}</button>
            {!out && <button type="button" onClick={() => onAiReply(m)} className="underline underline-offset-2" style={{ color: GREEN }}>Reply with AI</button>}
          </div>
        )}
      </div>
    </div>
  );
}

// The reply box. AI: "Write with AI" (Claude reads the chat) or an instruction in any language.
function Composer({ conv, mode, onSent, aiRequest, onAiDone }) {
  const windowOpen = !!conv?.window?.open;
  const [tab, setTab] = useState(windowOpen ? 'message' : 'template');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tpls, setTpls] = useState([]);
  const [tplName, setTplName] = useState('');
  const [vals, setVals] = useState({});
  const [ai, setAi] = useState(null);           // { english, note } of the last AI draft
  const [aiBusy, setAiBusy] = useState(false);
  const [askOpen, setAskOpen] = useState(false);
  const [ask, setAsk] = useState('');
  const fileRef = useRef(null);
  useEffect(() => { setTab(windowOpen ? 'message' : 'template'); setErr(''); setAi(null); setText(''); setAsk(''); setAskOpen(false); }, [conv?.phone]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!windowOpen) setTab('template'); }, [windowOpen]);
  useEffect(() => {
    fetch(`/api/inbox/templates?mode=${mode}`).then((r) => r.json()).then((j) => { const list = (j.data || []).filter((t) => t.status === 'APPROVED'); setTpls(list); if (list[0]) setTplName((n) => n || list[0].name); }).catch(() => setTpls([]));
  }, [mode]);
  const tpl = tpls.find((t) => t.name === tplName);
  const bodyN = tpl?.variables?.body || 0;
  const urlButtons = tpl?.variables?.url_buttons || [];
  const preview = useMemo(() => String(tpl?.body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => vals[`b${n}`] || `{{${n}}}`), [tpl, vals]);

  const writeWithAi = useCallback(async ({ instruction = '', draft = '' } = {}) => {
    setAiBusy(true); setErr('');
    try {
      const r = await fetch(`/api/inbox/ai?mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: conv.phone, instruction, draft }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error || `AI couldn't write it (${r.status})`); return; }
      setText(j.message); setAi({ english: j.english, note: j.note }); setAskOpen(false); setAsk('');
      if (windowOpen) setTab('message');
      else setErr('The 24h window is closed, so this text can\'t be sent yet — send a template first. The draft is kept in the Message tab.');
    } catch (e) { setErr(String(e)); } finally { setAiBusy(false); }
  }, [conv?.phone, mode, windowOpen]);
  // "Reply with AI" on a message in the thread
  useEffect(() => {
    if (!aiRequest || !conv) return;
    writeWithAi({ instruction: `Reply to this message from the contact: "${String(aiRequest.text || '').slice(0, 800)}"` });
    onAiDone();
  }, [aiRequest]); // eslint-disable-line react-hooks/exhaustive-deps

  const post = async (url, opts) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(url, opts);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message || j?.error?.code || `Could not send (${r.status})`); return false; }
      onSent(); return true;
    } catch (e) { setErr(String(e)); return false; } finally { setBusy(false); }
  };
  const sendText = async () => { if (!text.trim()) return; if (await post(`/api/inbox/send?mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', to: conv.phone, text }) })) { setText(''); setAi(null); } };
  const sendFile = async (f) => { if (!f) return; const fd = new FormData(); fd.set('to', conv.phone); fd.set('file', f); if (text.trim()) fd.set('caption', text); if (await post(`/api/inbox/upload?mode=${mode}`, { method: 'POST', body: fd })) setText(''); if (fileRef.current) fileRef.current.value = ''; };
  const sendTemplate = async () => {
    if (!tpl) return;
    const body = Array.from({ length: bodyN }, (_, i) => vals[`b${i + 1}`] || '');
    if (body.some((v) => !v.trim())) { setErr('Fill in every variable.'); return; }
    const buttons = urlButtons.map((index) => ({ index, text: vals[`u${index}`] || '' }));
    if (buttons.some((b) => !b.text.trim())) { setErr('Fill in the link ending.'); return; }
    if (await post(`/api/inbox/send?mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'template', to: conv.phone, template: tpl.name, language: tpl.language, variables: { body, ...(buttons.length ? { buttons } : {}) } }) })) setVals({});
  };

  const tabBtn = (v, label, icon, disabled) => (
    <button type="button" disabled={disabled} onClick={() => setTab(v)} className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[10px] text-[13.5px] font-semibold disabled:opacity-40"
      style={tab === v ? { background: '#E3F3EA', color: GREEN } : { color: T.textSecondary }}>{icon}{label}</button>
  );
  const inputCls = 'w-full px-3 py-2.5 rounded-[10px] text-[14px] outline-none bg-white';
  const inputStyle = { border: `1px solid ${T.borderLight}` };
  const sparkle = <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l1.8 4.6L18.5 9l-4.7 1.6L12 15l-1.8-4.4L5.5 9l4.7-1.4z" /><path d="M19 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" /></svg>;
  return (
    <div className="border-t px-4 pt-3 pb-4 bg-white" style={{ borderColor: T.borderLight }}>
      <div className="flex items-center justify-between gap-3 mb-2.5 flex-wrap">
        <div className="flex gap-1">
          {tabBtn('message', 'Message', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" /></svg>)}
          {tabBtn('template', 'Template', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>)}
        </div>
        <span className="text-[12.5px] flex items-center gap-1.5" style={{ color: T.textSecondary }}>
          🕓 {windowOpen ? `Reply window open${conv.window.expires_at ? ` until ${timeOf(conv.window.expires_at)}` : ''}` : '24h reply window closed: templates only'}
        </span>
      </div>
      {tab === 'message' ? (
        <div className="space-y-2">
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => fileRef.current?.click()} disabled={busy || !windowOpen} title="Send a photo, file or voice note" className="h-[46px] w-[46px] shrink-0 rounded-[10px] flex items-center justify-center disabled:opacity-40" style={inputStyle}>📎</button>
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => sendFile(e.target.files?.[0])} />
            <textarea value={text} onChange={(e) => { setText(e.target.value); if (ai) setAi((a) => a && { ...a, edited: true }); }} rows={text.length > 120 ? 3 : 1} placeholder={windowOpen ? 'Type a message — or let AI write it' : 'Window closed: you can draft here, but only a template can be sent'} className={`${inputCls} resize-none min-h-[46px]`} style={inputStyle} data-testid="composer-text"
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && windowOpen) { e.preventDefault(); sendText(); } }} />
            <button type="button" onClick={sendText} disabled={busy || !text.trim() || !windowOpen} className="h-[46px] px-5 shrink-0 rounded-[10px] text-white text-[14px] font-semibold disabled:opacity-50" style={{ background: GREEN }}>{busy ? 'Sending…' : 'Send'}</button>
          </div>
          {ai && (
            <div className="rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: '#F4F8F5', border: '1px solid #D5E8DC' }} data-testid="ai-english">
              <span className="font-semibold" style={{ color: GREEN }}>In English{ai.edited ? ' (before your edits)' : ''}:</span> <span style={{ color: T.textBody }}>{ai.english}</span>
              {ai.note && <div className="mt-1" style={{ color: T.textSecondary }}>Tip: {ai.note}</div>}
            </div>
          )}
          <div className="flex items-center gap-2 flex-wrap">
            <button type="button" onClick={() => writeWithAi({ draft: text.trim() })} disabled={aiBusy} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[10px] text-[13px] font-semibold disabled:opacity-50" style={{ border: `1px solid ${GREEN}`, color: GREEN }} data-testid="ai-write">
              {sparkle}{aiBusy ? 'Writing…' : text.trim() ? 'Improve with AI' : 'Write with AI'}
            </button>
            <button type="button" onClick={() => setAskOpen((o) => !o)} className="px-3 py-1.5 rounded-[10px] text-[13px]" style={{ color: T.textSecondary, border: `1px solid ${T.borderLight}` }}>Ask AI…</button>
            <span className="text-[11.5px]" style={{ color: T.textMuted }}>AI writes in the contact&apos;s language; you review and send.</span>
          </div>
          {askOpen && (
            <div className="flex items-stretch gap-2" data-testid="ai-ask">
              <input value={ask} onChange={(e) => setAsk(e.target.value)} placeholder="What should we say? Any language — e.g. “tell her we'll check her photos today”" className={inputCls} style={inputStyle}
                onKeyDown={(e) => { if (e.key === 'Enter' && ask.trim()) writeWithAi({ instruction: ask.trim() }); }} />
              <button type="button" onClick={() => writeWithAi({ instruction: ask.trim() })} disabled={aiBusy || !ask.trim()} className="px-4 shrink-0 rounded-[10px] text-white text-[13.5px] font-semibold disabled:opacity-50" style={{ background: GREEN }}>{aiBusy ? 'Writing…' : 'Write it'}</button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2.5">
          <div>
            <div className="text-[12.5px] mb-1" style={{ color: T.textSecondary }}>Template</div>
            <select value={tplName} onChange={(e) => { setTplName(e.target.value); setVals({}); }} className={inputCls} style={inputStyle}>
              {tpls.length === 0 && <option value="">No approved templates</option>}
              {tpls.map((t) => <option key={`${t.name}-${t.language}`} value={t.name}>{t.name} · {t.language} · {String(t.category).toLowerCase()}</option>)}
            </select>
          </div>
          {(bodyN > 0 || urlButtons.length > 0) && (
            <div className="grid gap-2.5 grid-cols-2 md:grid-cols-3">
              {Array.from({ length: bodyN }, (_, i) => (
                <label key={`b${i}`} className="block"><span className="text-[12px]" style={{ color: T.textSecondary }}>{`{{${i + 1}}}`}</span>
                  <input value={vals[`b${i + 1}`] || ''} onChange={(e) => setVals((v) => ({ ...v, [`b${i + 1}`]: e.target.value }))} className={inputCls} style={inputStyle} /></label>
              ))}
              {urlButtons.map((idx) => (
                <label key={`u${idx}`} className="block"><span className="text-[12px]" style={{ color: T.textSecondary }}>Link ending (button {idx + 1})</span>
                  <input value={vals[`u${idx}`] || ''} onChange={(e) => setVals((v) => ({ ...v, [`u${idx}`]: e.target.value }))} className={inputCls} style={inputStyle} /></label>
              ))}
            </div>
          )}
          <div className="flex items-stretch gap-2">
            <div className="flex-1 min-w-0 px-3 py-2.5 rounded-[10px] text-[13px] truncate" style={{ background: T.bgSurface, color: T.textBody }} title={preview}>{preview || '—'}</div>
            <button type="button" onClick={sendTemplate} disabled={busy || !tpl} className="px-5 shrink-0 rounded-[10px] text-white text-[14px] font-semibold disabled:opacity-50 inline-flex items-center gap-2" style={{ background: GREEN }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" /></svg>{busy ? 'Sending…' : 'Send template'}
            </button>
          </div>
          {!windowOpen && <p className="text-[11.5px]" style={{ color: T.textMuted }}>Outside the 24h window WhatsApp only allows approved templates. When they answer, the window opens and you can write (or let AI write) freely.</p>}
        </div>
      )}
      {err && <div className="mt-2 text-[12.5px] font-medium" style={{ color: T.danger }}>{err}</div>}
    </div>
  );
}

export default function InboxPage() {
  const [mode, setMode] = useState('live');
  const status = 'all';   // no Done state: Roland — "mark as unread, not mark as done"
  const [view, setView] = useState('all');          // all | unread | unresponded
  const [country, setCountry] = useState('');       // '' = the admin's active country (server decides)
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [counts, setCounts] = useState({});
  const [byCountry, setByCountry] = useState({});
  const [shownCountry, setShownCountry] = useState('');
  const [modes, setModes] = useState({ live: true, test: false });
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);       // phone
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const [contact, setContact] = useState(undefined);   // undefined = loading, null = not found
  const [english, setEnglish] = useState({});          // message id → English
  const [allEnglish, setAllEnglish] = useState(false);
  const [aiRequest, setAiRequest] = useState(null);
  const [tplMeta, setTplMeta] = useState({});
  const scrollRef = useRef(null);
  const lastIdRef = useRef(null);

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams({ mode, status, view, ...(country ? { country } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
    try {
      const r = await fetch(`/api/inbox/conversations?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.modes) setModes(j.modes);
      if (!r.ok) { setErr(j?.error?.message || j?.error || `HTTP ${r.status}`); setList([]); return; }
      setErr(''); setList(j.data || []); setCounts(j.counts || {}); setByCountry(j.byCountry || {}); setShownCountry(j.country || '');
    } catch (e) { setErr(String(e)); }
  }, [mode, status, view, country, q]);

  const loadThread = useCallback(async (phone, markRead = false) => {
    if (!phone) return;
    const p = encodeURIComponent(phone.replace(/\D/g, ''));
    const [c, m] = await Promise.all([
      fetch(`/api/inbox/conversations/${p}?mode=${mode}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      fetch(`/api/inbox/conversations/${p}/messages?mode=${mode}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ]);
    if (c && c.phone) setConv(c);
    if (m && Array.isArray(m.data)) setMsgs([...m.data].reverse());
    if (markRead && c && (c.unread_count || c.marked_unread)) fetch(`/api/inbox/conversations/${p}/read?mode=${mode}`, { method: 'POST' }).then(() => { loadList(); refreshUnread(); }).catch(() => {});
  }, [mode, loadList]);

  useEffect(() => { setList(null); loadList(); const t = setInterval(loadList, 6000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => { setSel(null); setConv(null); setMsgs([]); }, [mode]);
  useEffect(() => {
    fetch(`/api/inbox/templates?mode=${mode}`).then((r) => r.json()).then((j) => setTplMeta(Object.fromEntries((j.data || []).map((t) => [t.name, t])))).catch(() => setTplMeta({}));
  }, [mode]);
  useEffect(() => {
    setEnglish({}); setAllEnglish(false); setContact(undefined); setConv(null); setMsgs([]);
    if (!sel) return undefined;
    loadThread(sel, true);
    const t = setInterval(() => loadThread(sel), 4000);
    return () => clearInterval(t);
  }, [sel, loadThread]);
  // who this is on Casa Libre
  useEffect(() => {
    if (!sel || !conv || conv.phone !== sel || contact !== undefined) return;
    fetch(`/api/inbox/contact?phone=${encodeURIComponent(sel)}&country=${conv.country || ''}`).then((r) => r.json()).then((j) => setContact(j.contact || null)).catch(() => setContact(null));
  }, [sel, conv, contact]);
  // keep the thread scrolled to the newest message when one arrives
  useEffect(() => { const last = msgs[msgs.length - 1]?.id; if (last && last !== lastIdRef.current) { lastIdRef.current = last; requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }); } }, [msgs]);

  const translate = async (items) => {
    const todo = items.filter((m) => m.text && english[m.id] === undefined);
    if (!todo.length) return;
    const r = await fetch('/api/inbox/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texts: todo.map((m) => m.text) }) }).then((x) => x.json()).catch(() => null);
    if (!r?.english) return;
    setEnglish((e) => { const n = { ...e }; todo.forEach((m, i) => { n[m.id] = r.english[i] || null; }); return n; });
  };
  const toggleOne = (m) => { if (english[m.id]) setEnglish((e) => { const n = { ...e }; delete n[m.id]; return n; }); else translate([m]); };
  useEffect(() => { if (allEnglish) translate(msgs); }, [allEnglish, msgs]); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = async (body) => {
    const p = encodeURIComponent(sel.replace(/\D/g, ''));
    const r = await fetch(`/api/inbox/conversations/${p}?mode=${mode}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    loadThread(sel); loadList(); refreshUnread();
    return r.ok;
  };
  const addTag = () => { const t = window.prompt('Tag (e.g. hot lead, visita)'); if (t && t.trim()) patch({ add_tags: [t.trim()] }); };
  // Closing the chat keeps the dot until someone opens it again.
  const markUnread = async () => { const p = encodeURIComponent(sel.replace(/\D/g, '')); setSel(null); await fetch(`/api/inbox/conversations/${p}?mode=${mode}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ unread: true }) }); loadList(); refreshUnread(); };
  const setDnc = () => {
    if (conv?.dnc) { if (window.confirm('Remove "Do not contact" from this conversation?')) patch({ dnc: { on: false } }); return; }
    const note = window.prompt('Do not contact — a short note for the team (why). Max 35 characters.', '');
    if (note === null) return;
    patch({ dnc: { on: true, note } });
  };
  // Their activity page is per country: switch the admin to the contact's country first.
  const openProfile = async (e) => {
    if (!contact) return;
    e.preventDefault();
    if (contact.country && contact.country !== shownCountry) await fetch('/api/country', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: contact.country }) }).catch(() => {});
    window.location.href = contact.profileUrl;
  };

  const seg = (cur, set, v, label, n, testid) => (
    <button key={v} type="button" onClick={() => set(v)} data-testid={testid} className="flex-1 px-2.5 py-1.5 rounded-[8px] text-[13px] whitespace-nowrap" style={cur === v ? { background: '#fff', color: T.textPrimary, boxShadow: '0 1px 2px rgba(0,0,0,.08)', fontWeight: 600 } : { color: T.textSecondary }}>
      {label}{n != null ? <span className="ml-1 tabular-nums" style={{ color: v !== 'all' && v !== 'open' && v !== 'done' && n > 0 ? (v === 'unread' ? GREEN : T.danger) : T.textMuted, fontWeight: 600 }}>{n}</span> : null}
    </button>
  );
  // day separators in the thread
  const withDays = [];
  let lastDay = '';
  for (const m of msgs) { const d = new Date(m.timestamps?.created || m.created_at || Date.now()).toDateString(); if (d !== lastDay) { withDays.push({ day: m.timestamps?.created || m.created_at }); lastDay = d; } withDays.push(m); }
  const countryOptions = [...new Set([shownCountry, ...Object.keys(byCountry)].filter((c) => c && c !== 'all'))];

  return (
    <div className="space-y-3" data-testid="inbox-page">
      {err && <Banner>Inbox: {err}</Banner>}
      <div className="flex rounded-[16px] overflow-hidden bg-white" style={{ border: `1px solid ${T.borderLight}`, height: 'calc(100vh - 170px)', minHeight: 560 }}>
        {/* ---- conversation list ---- */}
        <div className="w-[360px] shrink-0 flex flex-col border-r" style={{ borderColor: T.borderLight }}>
          <div className="px-4 pt-4 pb-3 space-y-2.5 border-b" style={{ borderColor: T.borderLight }}>
            <div className="flex items-center justify-between gap-2">
              <h1 className="text-[20px] font-bold" style={{ color: T.textPrimary }}>Inbox</h1>
              <div className="inline-flex rounded-[10px] p-0.5" style={{ border: `1px solid ${T.borderLight}`, background: T.bgSurface }}>
                {[['live', 'Live'], ['test', 'Test keys']].map(([v, l]) => (
                  <button key={v} type="button" disabled={!modes[v]} title={!modes[v] ? (v === 'test' ? 'RELAY_TEST_API_KEY is not set' : 'RELAY_API_KEY is not set') : ''} onClick={() => setMode(v)}
                    className="px-3 py-1 rounded-[8px] text-[13px] disabled:opacity-40" style={mode === v ? { background: '#fff', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: T.textSecondary }}>{l}</button>
                ))}
              </div>
            </div>
            <select value={country || shownCountry} onChange={(e) => setCountry(e.target.value)} aria-label="Site" data-testid="inbox-country"
              className="w-full px-3 py-2 rounded-[10px] text-[13.5px] font-medium outline-none" style={{ border: `1px solid ${T.borderLight}`, background: '#fff', color: T.textPrimary }}>
              {countryOptions.map((c) => {
                const n = byCountry[c] || {};
                return <option key={c} value={c}>{COUNTRY_NAME[c] || c.toUpperCase()}{n.unread ? ` · ${n.unread} unread` : ''}{n.unresponded ? ` · ${n.unresponded} unanswered` : ''}</option>;
              })}
              <option value="all">All sites</option>
            </select>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" className="w-full pl-9 pr-3 py-2.5 rounded-[10px] text-[14px] outline-none" style={{ border: `1px solid ${T.borderLight}`, background: T.bgSurface }} />
            </div>
            <div className="flex rounded-[10px] p-0.5 w-full" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
              {seg(view, setView, 'all', 'Everything', null, 'view-all')}{seg(view, setView, 'unread', 'Unread', counts.unread, 'view-unread')}{seg(view, setView, 'unresponded', 'Unresponded', counts.unresponded, 'view-unresponded')}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {list === null ? <p className="p-4 text-[13px]" style={{ color: T.textMuted }}>Loading…</p>
              : list.length === 0 ? <p className="p-6 text-center text-[13px]" style={{ color: T.textMuted }}>{view === 'unread' ? 'Nothing unread.' : view === 'unresponded' ? 'Every conversation has an answer.' : 'No conversations here.'}</p>
                : list.map((c) => {
                  const lm = c.last_message || {};
                  const active = sel === c.phone;
                  const preview = lm.type === 'template' ? (TEMPLATE_LABEL[lm.template] || lm.template || lm.text) : (lm.text || (lm.type ? `(${lm.type})` : ''));
                  return (
                    <button key={c.phone} type="button" onClick={() => setSel(c.phone)} data-testid="conv-row" className="w-full text-left flex items-center gap-3 px-4 py-3 border-b transition-colors"
                      style={{ borderColor: T.borderLight, background: active ? '#EEF6F1' : '#fff' }}>
                      <Avatar c={c} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[15px] truncate" style={{ color: T.textPrimary, fontWeight: c.unread ? 700 : 500 }}>{c.name || formatPhone(c.phone)}</span>
                          <span className="text-[12px] shrink-0" style={{ color: c.unread ? GREEN : T.textMuted }}>{ago(lm.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-[13.5px] truncate flex items-center gap-1" style={{ color: T.textSecondary }}>{lm.direction === 'outbound' && <Ticks status={lm.status} />}{preview}</span>
                          {c.unread_count > 0 ? <span className="text-[11px] font-bold text-white rounded-full px-1.5 min-w-[20px] text-center" style={{ background: GREEN }}>{c.unread_count}</span>
                            : c.marked_unread ? <span className="w-3 h-3 rounded-full shrink-0" style={{ background: GREEN }} title="Marked unread" data-testid="marked-dot" /> : null}
                        </div>
                        <div className="flex gap-1 mt-1 flex-wrap items-center">
                          {(country === 'all' || (c.sites || []).length > 1) && (c.sites || []).map((x) => <span key={x} className="text-[10.5px] px-1.5 py-0.5 rounded-full font-mono" style={{ background: T.bgSurface, color: T.textSecondary }} title="Site this number came from">{x === 'none' ? 'no site' : x.toUpperCase()}</span>)}
                          {c.unresponded && !c.dnc && <span className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: '#FBEAEA', color: T.danger }}>needs an answer</span>}
                          {c.dnc && <span className="text-[10.5px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: T.danger, color: '#fff' }}>do not contact</span>}
                          {c.tags?.map((t) => <span key={t} className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>{t}</span>)}
                        </div>
                      </div>
                    </button>
                  );
                })}
          </div>
        </div>

        {/* ---- thread ---- */}
        <div className="flex-1 min-w-0 flex flex-col">
          {!sel ? (
            <div className="flex-1 flex items-center justify-center text-[14px]" style={{ color: T.textMuted, background: '#EFEAE2' }}>Pick a conversation</div>
          ) : (
            <>
              <div className="flex items-center gap-3 px-5 py-3 border-b bg-white flex-wrap" style={{ borderColor: T.borderLight }}>
                <Avatar c={conv} size={46} />
                <div className="min-w-0 flex-1">
                  {contact ? (
                    <Link href={contact.profileUrl} onClick={openProfile} className="text-[17px] font-semibold truncate block underline-offset-2 hover:underline" style={{ color: T.textPrimary }} data-testid="contact-link" title="Open their activity page">
                      {contact.user.name || conv?.name || formatPhone(sel)} ↗
                    </Link>
                  ) : <div className="text-[17px] font-semibold truncate" style={{ color: T.textPrimary }}>{conv?.name || formatPhone(sel)}</div>}
                  <div className="text-[12.5px] truncate" style={{ color: T.textSecondary }} data-testid="contact-sub">
                    {formatPhone(sel)}{conv?.sites ? ` · from ${siteNames(conv.sites)}` : ''}
                    {contact === undefined ? ' · …' : contact ? ` · ${contact.listings} ${contact.listings === 1 ? 'listing' : 'listings'}${contact.live !== contact.listings ? ` (${contact.live} live)` : ''}${contact.waitingPayment ? ` · ${contact.waitingPayment} waiting for payment` : ''}${contact.user.email ? ` · ${contact.user.email}` : ''}` : ' · not a Casa Libre account'}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {(conv?.tags || []).map((t) => (
                    <span key={t} className="text-[12px] pl-2.5 pr-1.5 py-1 rounded-full inline-flex items-center gap-1" style={{ background: T.bgSurface, color: T.textBody }}>{t}
                      <button type="button" onClick={() => patch({ remove_tags: [t] })} aria-label={`Remove ${t}`} style={{ color: T.textMuted }}>×</button></span>
                  ))}
                  <button type="button" onClick={addTag} className="text-[13px] px-3 py-1.5 rounded-full" style={{ border: `1px dashed ${T.borderLight}`, color: T.textSecondary }}>+ Tag</button>
                  <button type="button" onClick={() => setAllEnglish((v) => !v)} className="text-[13px] px-3 py-1.5 rounded-full" style={allEnglish ? { background: T.textPrimary, color: '#fff' } : { border: `1px solid ${T.borderLight}`, color: T.textSecondary }} data-testid="translate-all">{allEnglish ? 'English on' : 'Translate all'}</button>
                  <button type="button" onClick={setDnc} className="text-[13px] px-3 py-1.5 rounded-full" style={conv?.dnc ? { background: T.danger, color: '#fff' } : { border: `1px solid ${T.borderLight}`, color: T.danger }} data-testid="dnc">{conv?.dnc ? 'Do not contact ✓' : 'Do not contact'}</button>
                  <button type="button" onClick={markUnread} className="text-[14px] font-semibold px-4 py-2 rounded-[10px] text-white inline-flex items-center gap-2" style={{ background: GREEN }} data-testid="mark-unread" title="Put the dot back so someone comes back to it">
                    <span className="w-2.5 h-2.5 rounded-full bg-white" aria-hidden="true" />Mark as unread
                  </button>
                </div>
              </div>
              {conv?.dnc && (
                <div className="px-5 py-2 text-[13px] font-medium" style={{ background: '#FBEAEA', color: T.danger }} data-testid="dnc-banner">
                  Do not contact{conv.dnc.note ? ` — ${conv.dnc.note}` : ''}. Only answer if they write first.
                </div>
              )}
              {conv && !conv.dnc && conv.unresponded && (
                <div className="px-5 py-1.5 text-[12.5px]" style={{ background: '#FFF6E5', color: T.textBody }} data-testid="unresponded-banner">They wrote last — close the loop with an answer, even a short one.</div>
              )}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4" style={{ background: '#EFEAE2' }}>
                {withDays.map((x, i) => (x.day !== undefined
                  ? <div key={`d${i}`} className="flex justify-center my-3"><span className="text-[12.5px] px-3 py-1 rounded-[8px] bg-white shadow-sm" style={{ color: T.textSecondary }}>{dayLabel(x.day)}</span></div>
                  : <Bubble key={x.id} m={x} mode={mode} english={english[x.id]} tplMeta={tplMeta} onTranslate={toggleOne} onAiReply={(m) => setAiRequest({ text: m.text, at: Date.now() })} />))}
                {msgs.length === 0 && <p className="text-center text-[13px] mt-10" style={{ color: T.textMuted }}>No messages yet.</p>}
              </div>
              {conv && <Composer conv={conv} mode={mode} onSent={() => { loadThread(sel); loadList(); }} aiRequest={aiRequest} onAiDone={() => setAiRequest(null)} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
