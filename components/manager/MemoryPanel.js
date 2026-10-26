'use client';
// "What the manager remembers" — the standing notes every Admin Manager run reads
// (/api/manager/memory → automations row 'manager_memory'). Add a note in plain words
// ("Tahir already runs a rentals campaign"), forget one with ×. `suggestions` = lessons the
// last report proposed; Keep moves one into memory.
import { useEffect, useState } from 'react';
import { T, btnSecondary, inputCls } from '@/components/automations/ui';

export default function MemoryPanel({ suggestions = [], compact = false }) {
  const [notes, setNotes] = useState(null);
  const [text, setText] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/manager/memory').then((r) => r.json()).then((j) => setNotes(j.notes || [])).catch(() => setNotes([]));
  }, []);

  const call = async (method, body) => {
    setBusy(true); setErr('');
    const r = await fetch('/api/manager/memory', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(j.error || 'That did not save. Try again.'); return false; }
    setNotes(j.notes || []);
    return true;
  };
  const kept = new Set((notes || []).map((n) => n.text.toLowerCase()));
  const open = suggestions.filter((sg) => !kept.has(String(sg).toLowerCase()));

  return (
    <section className="rounded-[14px] bg-white" style={{ border: `1px solid ${T.borderLight}` }}>
      <header className="px-5 py-4 border-b" style={{ borderColor: T.borderLight }}>
        <h2 className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>What the manager remembers</h2>
        <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}>Every report follows these notes.</p>
      </header>
      <div className="px-5 py-4 space-y-3">
        {notes === null ? <p className="text-[12.5px]" style={{ color: T.textMuted }}>Loading…</p> : null}
        {notes?.length ? (
          <ul className="space-y-1.5">
            {notes.slice().reverse().slice(0, compact ? 6 : 60).map((n) => (
              <li key={n.id || n.text} className="flex items-start justify-between gap-3 text-[12.5px] leading-snug" style={{ color: T.textBody }}>
                <span>{n.text}<span className="block text-[11.5px] mt-0.5" style={{ color: T.textMuted }}>{n.source === 'suggestion' ? 'Lesson kept' : 'Note'}{n.by ? ` by ${n.by}` : ''}{n.at ? `, ${new Date(n.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}</span></span>
                <button type="button" disabled={busy} onClick={() => call('DELETE', { id: n.id })} aria-label={`Forget: ${n.text}`} className="shrink-0 text-[12px] px-2 py-1 rounded-md hover:bg-black/5" style={{ color: T.textMuted }}>Forget</button>
              </li>
            ))}
          </ul>
        ) : notes ? <p className="text-[12.5px]" style={{ color: T.textMuted }}>Nothing yet. Add what the manager should always know.</p> : null}

        {open.length ? (
          <div className="rounded-[10px] p-3" style={{ background: T.bgSurface }}>
            <p className="text-[12px] font-semibold" style={{ color: T.textSecondary }}>The manager suggests remembering</p>
            <ul className="mt-1.5 space-y-1.5">
              {open.map((sg) => (
                <li key={sg} className="flex items-start justify-between gap-3 text-[12.5px]" style={{ color: T.textBody }}>
                  <span>{sg}</span>
                  <button type="button" disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight }} onClick={() => call('POST', { text: sg, source: 'suggestion' })}>Keep</button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <form className="flex flex-col sm:flex-row gap-2" onSubmit={async (e) => { e.preventDefault(); if (await call('POST', { text })) setText(''); }}>
          <label className="sr-only" htmlFor="memory-note">New note</label>
          <input id="memory-note" value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Daniel's payment case is closed" className={inputCls} />
          <button type="submit" disabled={busy || text.trim().length < 3} className={btnSecondary} style={{ borderColor: T.borderLight }}>Add note</button>
        </form>
        {err ? <p className="text-[12px]" style={{ color: T.danger }}>{err}</p> : null}
      </div>
    </section>
  );
}
