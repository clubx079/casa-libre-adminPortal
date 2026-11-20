'use client';
// Overview → "Every country, last 7 days": one row per country; clicking a row opens that country
// (same as the header switcher: /api/country, then reload).
import { useState } from 'react';

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));

function Delta({ w, p }) {
  if (w == null || p == null) return null;
  if (!p) return w ? <span className="text-[11px] text-[#2F6B3A] font-semibold ml-1.5">new</span> : null;
  const pct = Math.round(((w - p) / p) * 100);
  if (!pct) return null;
  return <span className={`text-[11px] font-semibold ml-1.5 ${pct > 0 ? 'text-[#2F6B3A]' : 'text-[#B23A3A]'}`}>{pct > 0 ? '+' : '−'}{Math.abs(pct)}%</span>;
}

export function CountryTable({ rows = [], active }) {
  const [busy, setBusy] = useState(null);
  const open = async (code) => {
    if (code === active) return;
    setBusy(code);
    try {
      await fetch('/api/country', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      window.location.reload();
    } catch { setBusy(null); }
  };
  const max = Math.max(1, ...rows.map((r) => r.web?.w?.visitors || 0));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] min-w-[620px]">
        <caption className="sr-only">Every country, last 7 days, with the change from the 7 days before</caption>
        <thead>
          <tr className="text-left text-[12px] text-ink/50 whitespace-nowrap h-[44px] border-b border-ink/10">
            <th scope="col" className="font-medium px-5">Country</th>
            <th scope="col" className="font-medium px-3 w-[32%]">Visitors</th>
            <th scope="col" className="font-medium px-3 text-right">Contacts</th>
            <th scope="col" className="font-medium px-3 text-right">New users</th>
            <th scope="col" className="font-medium px-3 text-right">Owner listings</th>
            <th scope="col" className="font-medium px-5 text-right">Live listings</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const on = r.code === active;
            const v = r.web?.w?.visitors;
            return (
              <tr key={r.code} onClick={() => open(r.code)} className={`h-[56px] border-b border-ink/10 last:border-b-0 ${on ? 'bg-[#EEF3FB]' : 'cursor-pointer hover:bg-ink/[0.03]'}`}>
                <th scope="row" className="text-left font-semibold px-5 whitespace-nowrap">
                  <button type="button" onClick={(e) => { e.stopPropagation(); open(r.code); }} disabled={on || busy}
                    className="text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink rounded-sm disabled:cursor-default">
                    {r.label}
                    {on ? <span className="ml-2 text-[11px] font-medium text-ink/50">showing</span> : busy === r.code ? <span className="ml-2 text-[11px] font-medium text-ink/50">opening…</span> : null}
                  </button>
                </th>
                <td className="px-3">
                  {r.web === undefined ? <span className="text-ink/40">—</span> : (
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-[8px] rounded-full bg-ink/[0.06] overflow-hidden" aria-hidden>
                        <div className="h-full rounded-full bg-ink" style={{ width: `${v ? Math.max(3, (v / max) * 100) : 0}%` }} />
                      </div>
                      <span className="tabular-nums w-[74px] text-right">{fmt(v || 0)}<Delta w={v} p={r.web?.p?.visitors} /></span>
                    </div>
                  )}
                </td>
                <td className="px-3 text-right tabular-nums whitespace-nowrap">{r.web === undefined ? '—' : fmt(r.web?.w?.contacted || 0)}<Delta w={r.web?.w?.contacted} p={r.web?.p?.contacted} /></td>
                <td className="px-3 text-right tabular-nums whitespace-nowrap">{fmt(r.users?.w)}<Delta w={r.users?.w} p={r.users?.p} /></td>
                <td className="px-3 text-right tabular-nums whitespace-nowrap">{fmt(r.listings?.w)}<Delta w={r.listings?.w} p={r.listings?.p} /></td>
                <td className="px-5 text-right tabular-nums">{fmt(r.live)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
