'use client';
// Inbox — the Casa Libre WhatsApp conversations, the same inbox as in Relay (and kept in
// sync with it): list with Open / Done / All / Unread and search, the thread with ticks
// and media, replies by text / photo / file inside the 24h window, or by an approved
// template outside it, tags and "Mark as done". Live = the real number, Test keys =
// Relay's simulated traffic. Data: /api/inbox/* → Relay (lib/relayInbox.js). Refreshes
// itself every few seconds.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { T, Banner } from '@/components/automations/ui';
import { refreshUnread } from '@/components/unread';

const GREEN = '#0F6E4A';
const BUBBLE_OUT = '#D9FDD3';
const fmtPhone = (p) => { const d = String(p || '').replace(/\D/g, ''); return d ? `+${d.slice(0, d.length - 9)} ${d.slice(-9, -6)} ${d.slice(-6)}`.replace(/\s+/g, ' ').trim() : ''; };
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
  if (status === 'failed') return <span title="Failed" style={{ color: T.danger, fontWeight: 700 }}>!</span>;
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

function Bubble({ m, mode }) {
  const out = m.direction === 'outbound';
  const tplName = typeof m.template === 'string' ? m.template : m.template?.name;
  const created = m.timestamps?.created || m.created_at;
  return (
    <div className={`flex ${out ? 'justify-end' : 'justify-start'} mb-2`}>
      <div className="max-w-[72%] rounded-[12px] px-3 py-2 shadow-sm" style={{ background: out ? BUBBLE_OUT : '#fff' }}>
        {tplName && (
          <div className="text-[11.5px] font-semibold mb-0.5 flex items-center gap-1" style={{ color: GREEN }}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>
            {TEMPLATE_LABEL[tplName] || tplName}<span className="font-normal" style={{ color: T.textMuted }}> · {m.sent_by === 'api' ? 'API' : m.sent_by || m.kind}</span>
          </div>
        )}
        {!tplName && out && m.sent_by && m.sent_by !== 'api' && <div className="text-[11px] mb-0.5" style={{ color: T.textMuted }}>{m.sent_by}</div>}
        {m.media && <Media m={m} mode={mode} />}
        {m.location && <a className="text-[13px] underline" target="_blank" rel="noreferrer" href={`https://maps.google.com/?q=${m.location.latitude},${m.location.longitude}`}>📍 {m.location.name || 'Location'}</a>}
        {m.text && <div className="text-[14px] whitespace-pre-wrap break-words" style={{ color: T.textPrimary }}><Rich text={m.text} /></div>}
        {!m.text && !m.media && !m.location && <div className="text-[13px] italic" style={{ color: T.textMuted }}>({m.type || 'message'})</div>}
        <div className="flex items-center justify-end gap-1.5 mt-0.5 text-[11px]" style={{ color: T.textMuted }}>
          {m.error?.message && <span style={{ color: T.danger }} title={m.error.message}>failed</span>}
          {timeOf(created)}{out && <Ticks status={m.status} />}
        </div>
      </div>
    </div>
  );
}

function Composer({ conv, mode, onSent }) {
  const windowOpen = !!conv?.window?.open;
  const [tab, setTab] = useState(windowOpen ? 'message' : 'template');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [tpls, setTpls] = useState([]);
  const [tplName, setTplName] = useState('');
  const [vals, setVals] = useState({});
  const fileRef = useRef(null);
  useEffect(() => { setTab(windowOpen ? 'message' : 'template'); setErr(''); }, [conv?.phone, windowOpen]);
  useEffect(() => {
    fetch(`/api/inbox/templates?mode=${mode}`).then((r) => r.json()).then((j) => { const list = (j.data || []).filter((t) => t.status === 'APPROVED'); setTpls(list); if (list[0]) setTplName((n) => n || list[0].name); }).catch(() => setTpls([]));
  }, [mode]);
  const tpl = tpls.find((t) => t.name === tplName);
  const bodyN = tpl?.variables?.body || 0;
  const urlButtons = tpl?.variables?.url_buttons || [];
  const preview = useMemo(() => String(tpl?.body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => vals[`b${n}`] || `{{${n}}}`), [tpl, vals]);

  const post = async (url, opts) => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(url, opts);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j?.error?.message || j?.error?.code || `Could not send (${r.status})`); return false; }
      onSent(); return true;
    } catch (e) { setErr(String(e)); return false; } finally { setBusy(false); }
  };
  const sendText = async () => { if (!text.trim()) return; if (await post(`/api/inbox/send?mode=${mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: 'text', to: conv.phone, text }) })) setText(''); };
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
  return (
    <div className="border-t px-4 pt-3 pb-4 bg-white" style={{ borderColor: T.borderLight }}>
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <div className="flex gap-1">
          {tabBtn('message', 'Message', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12a8 8 0 0 1-11.8 7L4 20l1.1-4.6A8 8 0 1 1 21 12z" /></svg>, !windowOpen)}
          {tabBtn('template', 'Template', <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>)}
        </div>
        <span className="text-[12.5px] flex items-center gap-1.5" style={{ color: T.textSecondary }}>
          🕓 {windowOpen ? `Reply window open${conv.window.expires_at ? ` until ${timeOf(conv.window.expires_at)}` : ''}` : '24h reply window closed: templates only'}
        </span>
      </div>
      {tab === 'message' ? (
        <div className="flex items-end gap-2">
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} title="Send a photo, file or voice note" className="h-[46px] w-[46px] shrink-0 rounded-[10px] flex items-center justify-center" style={inputStyle}>📎</button>
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => sendFile(e.target.files?.[0])} />
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={1} placeholder="Type a message" className={`${inputCls} resize-none min-h-[46px]`} style={inputStyle}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendText(); } }} />
          <button type="button" onClick={sendText} disabled={busy || !text.trim()} className="h-[46px] px-5 shrink-0 rounded-[10px] text-white text-[14px] font-semibold disabled:opacity-50" style={{ background: GREEN }}>{busy ? 'Sending…' : 'Send'}</button>
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
        </div>
      )}
      {err && <div className="mt-2 text-[12.5px] font-medium" style={{ color: T.danger }}>{err}</div>}
    </div>
  );
}

export default function InboxPage() {
  const [mode, setMode] = useState('live');
  const [status, setStatus] = useState('open');
  const [unread, setUnread] = useState(false);
  const [q, setQ] = useState('');
  const [list, setList] = useState(null);
  const [counts, setCounts] = useState({});
  const [modes, setModes] = useState({ live: true, test: false });
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);       // phone
  const [conv, setConv] = useState(null);
  const [msgs, setMsgs] = useState([]);
  const scrollRef = useRef(null);
  const lastIdRef = useRef(null);

  const loadList = useCallback(async () => {
    const qs = new URLSearchParams({ mode, status, ...(unread ? { unread: 'true' } : {}), ...(q.trim() ? { q: q.trim() } : {}) });
    try {
      const r = await fetch(`/api/inbox/conversations?${qs}`, { cache: 'no-store' });
      const j = await r.json();
      if (j.modes) setModes(j.modes);
      if (!r.ok) { setErr(j?.error?.message || j?.error || `HTTP ${r.status}`); setList([]); return; }
      setErr(''); setList(j.data || []); setCounts(j.counts || {});
    } catch (e) { setErr(String(e)); }
  }, [mode, status, unread, q]);

  const loadThread = useCallback(async (phone, markRead = false) => {
    if (!phone) return;
    const p = encodeURIComponent(phone.replace(/\D/g, ''));
    const [c, m] = await Promise.all([
      fetch(`/api/inbox/conversations/${p}?mode=${mode}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
      fetch(`/api/inbox/conversations/${p}/messages?mode=${mode}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null),
    ]);
    if (c && c.phone) setConv(c);
    if (m && Array.isArray(m.data)) setMsgs([...m.data].reverse());
    if (markRead && c?.unread_count) fetch(`/api/inbox/conversations/${p}/read?mode=${mode}`, { method: 'POST' }).then(() => { loadList(); refreshUnread(); }).catch(() => {});
  }, [mode, loadList]);

  useEffect(() => { setList(null); loadList(); const t = setInterval(loadList, 6000); return () => clearInterval(t); }, [loadList]);
  useEffect(() => { setSel(null); setConv(null); setMsgs([]); }, [mode]);
  useEffect(() => { if (!sel) return undefined; loadThread(sel, true); const t = setInterval(() => loadThread(sel), 4000); return () => clearInterval(t); }, [sel, loadThread]);
  // keep the thread scrolled to the newest message when one arrives
  useEffect(() => { const last = msgs[msgs.length - 1]?.id; if (last && last !== lastIdRef.current) { lastIdRef.current = last; requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }); } }, [msgs]);

  const patch = async (body) => {
    const p = encodeURIComponent(sel.replace(/\D/g, ''));
    await fetch(`/api/inbox/conversations/${p}?mode=${mode}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    loadThread(sel); loadList();
  };
  const addTag = () => { const t = window.prompt('Tag (e.g. hot lead, visita)'); if (t && t.trim()) patch({ add_tags: [t.trim()] }); };

  const filterBtn = (v, label, n) => (
    <button type="button" onClick={() => setStatus(v)} className="px-3 py-1.5 rounded-[8px] text-[13.5px]" style={status === v ? { background: '#fff', color: T.textPrimary, boxShadow: '0 1px 2px rgba(0,0,0,.08)', fontWeight: 600 } : { color: T.textSecondary }}>
      {label}{n != null ? ` ${n}` : ''}
    </button>
  );
  // day separators in the thread
  const withDays = [];
  let lastDay = '';
  for (const m of msgs) { const d = new Date(m.timestamps?.created || m.created_at || Date.now()).toDateString(); if (d !== lastDay) { withDays.push({ day: m.timestamps?.created || m.created_at }); lastDay = d; } withDays.push(m); }

  return (
    <div className="space-y-3" data-testid="inbox-page">
      {err && <Banner>Inbox: {err}</Banner>}
      <div className="flex rounded-[16px] overflow-hidden bg-white" style={{ border: `1px solid ${T.borderLight}`, height: 'calc(100vh - 170px)', minHeight: 560 }}>
        {/* ---- conversation list ---- */}
        <div className="w-[340px] shrink-0 flex flex-col border-r" style={{ borderColor: T.borderLight }}>
          <div className="px-4 pt-4 pb-3 space-y-3 border-b" style={{ borderColor: T.borderLight }}>
            <div className="flex items-center justify-between">
              <h1 className="text-[20px] font-bold" style={{ color: T.textPrimary }}>Inbox</h1>
              <div className="inline-flex rounded-[10px] p-0.5" style={{ border: `1px solid ${T.borderLight}`, background: T.bgSurface }}>
                {[['live', 'Live'], ['test', 'Test keys']].map(([v, l]) => (
                  <button key={v} type="button" disabled={!modes[v]} title={!modes[v] ? (v === 'test' ? 'RELAY_TEST_API_KEY is not set' : 'RELAY_API_KEY is not set') : ''} onClick={() => setMode(v)}
                    className="px-3 py-1 rounded-[8px] text-[13px] disabled:opacity-40" style={mode === v ? { background: '#fff', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: T.textSecondary }}>{l}</button>
                ))}
              </div>
            </div>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or number" className="w-full pl-9 pr-3 py-2.5 rounded-[10px] text-[14px] outline-none" style={{ border: `1px solid ${T.borderLight}`, background: T.bgSurface }} />
            </div>
            <div className="flex items-center gap-2">
              <div className="inline-flex rounded-[10px] p-0.5" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
                {filterBtn('open', 'Open', counts.open)}{filterBtn('done', 'Done', counts.done)}{filterBtn('all', 'All', null)}
              </div>
              <button type="button" onClick={() => setUnread((u) => !u)} className="px-3 py-1.5 rounded-[10px] text-[13.5px]" style={unread ? { background: T.textPrimary, color: '#fff' } : { border: `1px solid ${T.borderLight}`, color: T.textSecondary }}>Unread</button>
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {list === null ? <p className="p-4 text-[13px]" style={{ color: T.textMuted }}>Loading…</p>
              : list.length === 0 ? <p className="p-6 text-center text-[13px]" style={{ color: T.textMuted }}>No conversations here.</p>
                : list.map((c) => {
                  const lm = c.last_message || {};
                  const active = sel === c.phone;
                  const preview = lm.type === 'template' ? (TEMPLATE_LABEL[lm.template] || lm.template || lm.text) : (lm.text || (lm.type ? `(${lm.type})` : ''));
                  return (
                    <button key={c.phone} type="button" onClick={() => setSel(c.phone)} className="w-full text-left flex items-center gap-3 px-4 py-3 border-b transition-colors"
                      style={{ borderColor: T.borderLight, background: active ? '#EEF6F1' : '#fff' }}>
                      <Avatar c={c} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[15px] truncate" style={{ color: T.textPrimary, fontWeight: c.unread_count ? 700 : 500 }}>{c.name || fmtPhone(c.phone)}</span>
                          <span className="text-[12px] shrink-0" style={{ color: c.unread_count ? GREEN : T.textMuted }}>{ago(lm.created_at)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <span className="text-[13.5px] truncate flex items-center gap-1" style={{ color: T.textSecondary }}>{lm.direction === 'outbound' && <Ticks status={lm.status} />}{preview}</span>
                          {c.unread_count > 0 && <span className="text-[11px] font-bold text-white rounded-full px-1.5 min-w-[20px] text-center" style={{ background: GREEN }}>{c.unread_count}</span>}
                        </div>
                        {c.tags?.length > 0 && <div className="flex gap-1 mt-1 flex-wrap">{c.tags.map((t) => <span key={t} className="text-[10.5px] px-1.5 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>{t}</span>)}</div>}
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
              <div className="flex items-center gap-3 px-5 py-3 border-b bg-white" style={{ borderColor: T.borderLight }}>
                <Avatar c={conv} size={46} />
                <div className="min-w-0 flex-1">
                  <div className="text-[17px] font-semibold truncate" style={{ color: T.textPrimary }}>{conv?.name || fmtPhone(sel)}</div>
                  <div className="text-[13px]" style={{ color: T.textSecondary }}>{conv?.name ? fmtPhone(sel) : 'Not in contacts'}</div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {(conv?.tags || []).map((t) => (
                    <span key={t} className="text-[12px] pl-2.5 pr-1.5 py-1 rounded-full inline-flex items-center gap-1" style={{ background: T.bgSurface, color: T.textBody }}>{t}
                      <button type="button" onClick={() => patch({ remove_tags: [t] })} aria-label={`Remove ${t}`} style={{ color: T.textMuted }}>×</button></span>
                  ))}
                  <button type="button" onClick={addTag} className="text-[13px] px-3 py-1.5 rounded-full" style={{ border: `1px dashed ${T.borderLight}`, color: T.textSecondary }}>+ Tag</button>
                  {conv?.status === 'done'
                    ? <button type="button" onClick={() => patch({ status: 'open' })} className="text-[14px] font-semibold px-4 py-2 rounded-[10px]" style={{ border: `1px solid ${T.borderLight}`, color: T.textBody }}>Reopen</button>
                    : <button type="button" onClick={() => patch({ status: 'done' })} className="text-[14px] font-semibold px-4 py-2 rounded-[10px] text-white inline-flex items-center gap-2" style={{ background: GREEN }}>✓ Mark as done</button>}
                </div>
              </div>
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4" style={{ background: '#EFEAE2' }}>
                {withDays.map((x, i) => (x.day !== undefined
                  ? <div key={`d${i}`} className="flex justify-center my-3"><span className="text-[12.5px] px-3 py-1 rounded-[8px] bg-white shadow-sm" style={{ color: T.textSecondary }}>{dayLabel(x.day)}</span></div>
                  : <Bubble key={x.id} m={x} mode={mode} />))}
                {msgs.length === 0 && <p className="text-center text-[13px] mt-10" style={{ color: T.textMuted }}>No messages yet.</p>}
              </div>
              {conv && <Composer conv={conv} mode={mode} onSent={() => loadThread(sel)} />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
