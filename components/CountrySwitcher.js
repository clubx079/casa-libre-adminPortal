'use client';
// Active-country switcher for the shared admin. Picking a country POSTs to
// /api/country (sets the cl_admin_country cookie) then hard-reloads so every
// server component re-queries that country's DB.
import { useState, useEffect, useRef } from 'react';

export default function CountrySwitcher({ countries = [], active }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef(null);
  const cur = countries.find((c) => c.code === active) || { code: active, label: (active || '').toUpperCase() };

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  async function pick(code) {
    if (code === active) { setOpen(false); return; }
    setBusy(true);
    try {
      await fetch('/api/country', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }),
      });
      window.location.reload(); // re-run all server components with the new cookie
    } catch { setBusy(false); }
  }

  const codePill = (code, on) =>
    `font-mono text-[10px] uppercase tracking-label px-1.5 py-0.5 rounded ${on ? 'bg-paper text-ink' : 'bg-ink text-paper'}`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        disabled={busy}
        className="flex items-center gap-2 h-9 px-3 rounded-pill border border-ink/20 bg-card text-[13px] font-semibold hover:bg-ink/5 disabled:opacity-60"
      >
        <span className={codePill(cur.code, false)}>{cur.code}</span>
        <span className="max-w-[120px] truncate">{cur.label}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-ink/50">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-[calc(100%+6px)] min-w-[220px] bg-card border border-ink/15 rounded-[12px] shadow-hard-sm overflow-hidden z-[120]">
          <div className="px-3.5 pt-2.5 pb-1.5 text-[10px] font-mono uppercase tracking-label text-ink/40">Switch country</div>
          {countries.map((c) => {
            const on = c.code === active;
            return (
              <button
                key={c.code}
                disabled={busy}
                onClick={() => pick(c.code)}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-left transition-colors ${on ? 'bg-ink text-paper' : 'hover:bg-ink/5'}`}
              >
                <span className={codePill(c.code, on)}>{c.code}</span>
                <span className="flex-1 truncate">{c.label}</span>
                {c.is_live ? (
                  <span className={`text-[9px] font-mono uppercase tracking-label px-1.5 py-0.5 rounded ${on ? 'bg-paper/20 text-paper' : 'bg-[#C0392B] text-white'}`}>live</span>
                ) : (
                  <span className={`text-[9px] font-mono uppercase tracking-label ${on ? 'text-paper/60' : 'text-ink/35'}`}>soon</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
