'use client';
// Alerts — every WhatsApp chat that needs a person, at a glance, until a team member actually
// answers: the assistant handed it over (needs-a-person), an agency tapped CARTERA, a developer
// tapped PROYECTO. Opening the chat doesn't clear it — writing in it does, or "Mark handled".
// Open ones on top, newest first; handled / answered ones (last 7 days) collapsed below.
// Everything in English. Refreshes itself every 30 s. Data: /api/alerts (lib/alerts*.js).
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { T, CARD, Banner, PageHeader, Pill, fmtDate, btnPrimary, btnSecondary } from '@/components/automations/ui';
import { useDialog } from '@/components/Dialog';
import { refreshUnread } from '@/components/unread';
import { formatPhone } from '@/lib/inboxRules';
import { chatLink } from '@/lib/alerts';

const TONE = { person: 'danger', cartera: 'warning', proyecto: 'info' };
const dur = (ms) => {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(1, m)} min`;
  const h = ms / 3600000;
  if (h < 24) return `${Math.floor(h)} h${m % 60 && h < 6 ? ` ${m % 60} min` : ''}`;
  return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'}${Math.floor(h % 24) ? ` ${Math.floor(h % 24)} h` : ''}`;
};

function WindowChip({ hours }) {
  if (hours == null) return <span className="text-[11.5px] px-2 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textMuted }} title="They last wrote more than 24 hours ago: only a WhatsApp template can reach them now">Window closed · template only</span>;
  const left = hours < 1 ? `${Math.max(1, Math.round(hours * 60))} min` : `${Math.floor(hours)} h`;
  return <span className="text-[11.5px] px-2 py-0.5 rounded-full font-medium" style={hours < 3 ? { background: T.dangerSurface, color: T.danger } : { background: T.successSurface, color: T.success }} title="WhatsApp's 24-hour window: a normal message can still go out" data-testid="alert-window">{left} left in the 24 h window</span>;
}

function Alert({ a, mode, now, busy, onHandled }) {
  const [showDraft, setShowDraft] = useState(false);
  const open = a.status === 'open';
  const waited = now - Date.parse(a.since);
  const wrote = a.wroteEn?.length ? a.wroteEn : a.wrote || [];
  return (
    <li className="px-5 py-4 border-t first:border-t-0" style={{ borderColor: T.borderLight, opacity: open ? 1 : 0.7 }} data-testid="alert" data-alert-id={a.id} data-status={a.status}>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={open ? TONE[a.type] : 'neutral'}>{a.label}</Pill>
        <b className="text-[15px]" style={{ color: T.textPrimary }}>{a.name}</b>
        <span className="text-[13px] tabular-nums" style={{ color: T.textSecondary }}>{formatPhone(a.phone)}</span>
        {a.account && a.whatsappName && a.whatsappName !== a.name && <span className="text-[12px]" style={{ color: T.textMuted }}>WhatsApp: {a.whatsappName}</span>}
        {!a.account && <span className="text-[12px]" style={{ color: T.textMuted }}>no account</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[12.5px]" style={{ color: T.textSecondary }}>
        {open ? (
          <>
            <span className="font-semibold" style={{ color: waited > 3600000 ? T.danger : T.textPrimary }} data-testid="alert-waiting">Waiting {dur(waited)}</span>
            <span style={{ color: T.textMuted }}>since {fmtDate(a.since, true)}</span>
            <WindowChip hours={a.windowHours == null ? null : Math.max(0, a.windowHours - (now - Date.parse(a.checkedAt || now)) / 3600000)} />
          </>
        ) : (
          <span style={{ color: T.success }} className="font-medium">
            {a.closed?.how === 'answered' ? `Answered by ${a.closed.by || 'the team'}` : `Marked handled${a.closed?.by ? ` by ${a.closed.by}` : ''}`}
            {a.closed?.at ? ` · ${fmtDate(a.closed.at, true)}` : ''}
            <span className="font-normal" style={{ color: T.textMuted }}> · waited {dur(Date.parse(a.closed?.at || now) - Date.parse(a.since))}</span>
          </span>
        )}
      </div>

      {wrote.length > 0 && (
        <div className="mt-2">
          <p className="text-[11.5px] font-semibold uppercase tracking-label" style={{ color: T.textMuted }}>They wrote</p>
          <ul className="mt-0.5 space-y-0.5">
            {wrote.map((w, k) => <li key={k} className="text-[13.5px] leading-snug" style={{ color: T.textPrimary }} title={a.wrote?.[k] !== w ? a.wrote?.[k] : undefined}>“{w}”</li>)}
          </ul>
        </div>
      )}
      <p className="text-[13px] leading-snug mt-2" style={{ color: T.textBody }}>
        <span className="font-semibold">{a.type === 'person' ? 'Why a person:' : 'What they want:'}</span> {a.reason}{a.topic ? <span style={{ color: T.textMuted }}> · topic: {a.topic}</span> : null}
      </p>
      {a.type === 'person' && (a.holdingEn || a.holding) && (
        <p className="text-[12.5px] leading-snug mt-1" style={{ color: T.textSecondary }}>We told them: “{a.holdingEn || a.holding}”</p>
      )}
      {a.draft && (
        <div className="mt-1.5">
          <button type="button" onClick={() => setShowDraft((v) => !v)} className="text-[12.5px] font-medium underline-offset-2 hover:underline" style={{ color: T.textSecondary }} data-testid="alert-draft-toggle">{showDraft ? 'Hide the AI draft' : 'Show the AI draft'}</button>
          {showDraft && <p className="mt-1 pl-3 border-l-2 text-[13px] leading-relaxed whitespace-pre-wrap" style={{ borderColor: T.borderLight, color: T.textBody }} title={a.draft.es}>{a.draft.en || a.draft.es}</p>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <Link href={chatLink(a.digits, mode)} className={open ? btnPrimary : btnSecondary} style={open ? {} : { borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary }} data-testid="alert-open-chat">Open chat</Link>
        {open && <button type="button" disabled={busy} onClick={() => onHandled(a)} className={btnSecondary} style={{ borderColor: 'rgba(17,17,17,.25)', color: T.textPrimary }} data-testid="alert-handled">{busy ? 'Saving…' : 'Mark handled'}</button>}
      </div>
    </li>
  );
}

export default function AlertsPage() {
  const { dialog, confirm } = useDialog();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState('');
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(async (fresh = false) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/alerts${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' });
      const j = await r.json();
      if (!r.ok || j.error) throw new Error(j.error?.message || j.error || `HTTP ${r.status}`);
      setData(j); setErr(''); setNow(Date.now());
      refreshUnread();   // the sidebar badge follows the page
    } catch (e) { setErr(String(e.message || e)); }
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(() => load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const onHandled = async (a) => {
    if (!(await confirm({ title: `Mark handled?`, message: `${a.name} (${a.label}) leaves the open alerts and the “${a.tag}” tag is removed from the chat. Use this only if someone took care of it outside this chat.`, confirmLabel: 'Mark handled' }))) return;
    setBusy(a.id); setMsg('');
    try {
      const r = await fetch('/api/alerts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, action: 'handled' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) setMsg(j.error || 'Could not mark it handled.');
      await load(true);
    } finally { setBusy(null); }
  };

  const all = (data?.alerts || []).map((a) => ({ ...a, checkedAt: data?.generatedAt }));
  const open = all.filter((a) => a.status === 'open');
  const closed = all.filter((a) => a.status !== 'open');

  return (
    <div className="space-y-4 max-w-[980px]" data-testid="alerts-page">
      {dialog}
      <PageHeader
        title="Alerts"
        sub="Every WhatsApp chat that needs a person. An alert stays open until someone from the team writes in that chat, or marks it handled — opening the chat is not enough."
        action={(
          <div className="flex items-center gap-3">
            {data && <span className="text-[11.5px]" style={{ color: T.textMuted }}>Checked {fmtDate(data.generatedAt, true)} · every 30 s{data.mode === 'test' ? ' · Relay test chats' : ''}</span>}
            <button type="button" onClick={() => load(true)} disabled={loading} className={btnSecondary} style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary }} data-testid="alerts-refresh">{loading ? 'Checking…' : 'Refresh'}</button>
          </div>
        )}
      />
      {err && <Banner>Could not load the alerts: {err}</Banner>}
      {msg && <Banner>{msg}</Banner>}

      <section className="bg-white overflow-hidden" style={CARD}>
        <div className="px-5 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: T.borderLight }}>
          <h2 className="text-[15px] font-semibold" style={{ color: T.textPrimary }} data-testid="alerts-open-count">
            {data ? (open.length ? `${open.length} waiting for a person` : 'Nobody is waiting') : 'Loading…'}
          </h2>
          {data && open.length > 0 && (
            <span className="text-[12px]" style={{ color: T.textMuted }}>
              {[['person', 'needs a person'], ['cartera', 'CARTERA'], ['proyecto', 'PROYECTO']].map(([k, l]) => (data.counts?.byType?.[k] ? `${data.counts.byType[k]} ${l}` : '')).filter(Boolean).join(' · ')}
            </span>
          )}
        </div>
        {!data && !err && <div className="px-5 py-4 space-y-2">{[0, 1, 2].map((k) => <div key={k} className="h-16 rounded-[10px] animate-pulse" style={{ background: 'rgba(17,17,17,.05)' }} />)}</div>}
        {data && !open.length && <p className="px-5 py-6 text-[13.5px]" style={{ color: T.textSecondary }}>Every chat that needed a person has been answered.</p>}
        <ul>{open.map((a) => <Alert key={a.id} a={a} mode={data?.mode} now={now} busy={busy === a.id} onHandled={onHandled} />)}</ul>
      </section>

      {closed.length > 0 && (
        <section className="bg-white overflow-hidden" style={CARD}>
          <button type="button" onClick={() => setShowClosed((v) => !v)} className="w-full px-5 py-3 flex items-center justify-between text-left" data-testid="alerts-closed-toggle">
            <span className="text-[14px] font-semibold" style={{ color: T.textSecondary }}>Handled in the last 7 days · {closed.length}</span>
            <span className="text-[12.5px]" style={{ color: T.textMuted }}>{showClosed ? 'Hide' : 'Show'}</span>
          </button>
          {showClosed && <ul className="border-t" style={{ borderColor: T.borderLight }}>{closed.map((a) => <Alert key={a.id} a={a} mode={data?.mode} now={now} busy={false} onHandled={onHandled} />)}</ul>}
        </section>
      )}
    </div>
  );
}
