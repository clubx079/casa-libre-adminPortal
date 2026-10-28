'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, ExternalLink, Search, Download } from 'lucide-react';
import { CATEGORY_LABEL, CATEGORY_TABS, SOURCES, waDigits, filterLeads, hasContact, leadsCsv } from '@/lib/potentialLeads';

const T = {
  textPrimary: '#111111', textBody: '#3A3A37', textSecondary: '#6B6862', textMuted: '#9C978C',
  borderLight: '#E7E1D6', bgSurface: '#FAF7F1',
  success: '#0F6E56', successSurface: '#E4F1E9', warning: '#8A5A12', warningSurface: '#F5EAD5',
  info: '#2A5B8A', infoSurface: '#E1ECF5', danger: '#B23A3A', dangerSurface: '#F6E4E1',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

export default function LeadsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [country, setCountry] = useState('');
  const [cat, setCat] = useState('all');
  const [contact, setContact] = useState('all');
  const [q, setQ] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/leads', { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) { setError(true); return; }
        setRows(json.rows || []); setPending(!!json.pending); setCountry(json.country || '');
      } catch { setError(true); } finally { setLoading(false); }
    })();
  }, []);

  const catCounts = useMemo(() => rows.reduce((a, r) => { const c = r.category || 'other'; a[c] = (a[c] || 0) + 1; return a; }, {}), [rows]);
  const withContact = rows.filter(hasContact).length;
  const withWa = rows.filter((r) => r.whatsapp).length;
  const withEmail = rows.filter((r) => r.email).length;
  // Export what's on screen (the tab, search and filter applied) — one column per way to reach them
  const exportCsv = () => {
    const blob = new Blob([leadsCsv(shown)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const tag = [country || 'leads', cat !== 'all' ? cat : '', contact !== 'all' ? contact : ''].filter(Boolean).join('-');
    a.download = `leads-${tag}-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const shown = filterLeads(rows, { q, contact, category: cat });
  const sources = [...new Set(rows.map((r) => r.source))];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Leads</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>
            Potential clients we found ourselves — agents, agencies and developers to contact.
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-4 text-[12px]" style={{ color: T.textSecondary }}>
            <span><b style={{ color: T.textPrimary }}>{rows.length}</b> leads</span>
            <span><b style={{ color: T.textPrimary }}>{withContact}</b> with contact</span>
            <span><b style={{ color: T.textPrimary }}>{withWa}</b> WhatsApp</span>
            <span><b style={{ color: T.textPrimary }}>{withEmail}</b> email</span>
            {sources.map((s) => (
              <a key={s} href={SOURCES[s]?.list || '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                Source: {SOURCES[s]?.label || s}<ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* type tabs */}
      <div className="flex items-center gap-6 border-b" style={{ borderColor: T.borderLight }} data-testid="lead-type-tabs">
        {[['all', 'All types'], ...CATEGORY_TABS.filter(([k]) => k !== 'other' || catCounts.other)].map(([k, label]) => {
          const on = cat === k;
          return (
            <button key={k} onClick={() => setCat(k)} className="pb-2.5 -mb-px text-[14px] font-semibold border-b-2 transition-colors"
              style={on ? { borderColor: T.textPrimary, color: T.textPrimary } : { borderColor: 'transparent', color: T.textSecondary }}>
              {label} <span className="ml-1 text-[11px] font-mono" style={{ color: T.textMuted }}>{k === 'all' ? rows.length : (catCounts[k] || 0)}</span>
            </button>
          );
        })}
      </div>

      {/* search + contact filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }}>
          <Search className="w-4 h-4" style={{ color: T.textMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, agency, location, phone…" className="flex-1 bg-transparent outline-none text-[13px]" />
        </label>
        <div className="flex items-center gap-1 p-1 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }}>
          {[['all', 'All'], ['whatsapp', 'Has WhatsApp'], ['email', 'Has email'], ['with', 'Any contact'], ['without', 'No contact']].map(([k, label]) => (
            <button key={k} onClick={() => setContact(k)} className="px-3 py-1 rounded-full text-[12.5px] font-medium"
              style={contact === k ? { background: T.textPrimary, color: '#fff' } : { color: T.textBody }}>{label}</button>
          ))}
        </div>
        <button onClick={exportCsv} disabled={!shown.length} data-testid="leads-export"
          className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-full text-[12.5px] font-semibold disabled:opacity-40"
          style={{ border: `1px solid ${T.textPrimary}`, color: T.textPrimary, background: '#fff' }}>
          <Download className="w-3.5 h-3.5" />Export CSV ({shown.length})
        </button>
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 640, overflow: 'auto' }}>
          <table className="w-full min-w-[1020px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Lead', 'Phone', 'WhatsApp', 'Email', 'Location', 'Type', 'Source'].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left`} style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(7)].map((__, j) => (<td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '150px' : '80px', background: T.bgSurface }} /></td>))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load leads. Check the DB connection.</td></tr>
              ) : pending ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: T.textSecondary }}>The leads table isn&apos;t set up on the {country.toUpperCase() || 'current'} database yet (migration 006_potential_leads.sql).</td></tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Target className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>{rows.length ? 'No leads match these filters' : 'No leads yet'}</p>
                  </td>
                </tr>
              ) : shown.map((r) => (
                <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }} data-testid="lead-row">
                  <td className="px-4 py-3 max-w-[240px]">
                    <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={r.name}>{r.name}</p>
                    {r.legal_name && <p className="text-[11px] truncate" style={{ color: T.textMuted }} title={r.legal_name}>{r.category === 'agent' ? `Agency: ${r.legal_name}` : r.legal_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {r.phone ? <a href={`tel:${r.phone.replace(/\s/g, '')}`} className="hover:underline" style={{ color: T.textBody }}>{r.phone}</a> : <span style={{ color: T.textMuted }}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap">
                    {r.whatsapp ? (
                      <a href={`https://wa.me/${waDigits(r.whatsapp)}`} target="_blank" rel="noreferrer" title="Open in WhatsApp" className="inline-flex items-center gap-1.5 hover:underline" style={{ color: T.textBody }}>
                        {r.whatsapp}<span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: T.successSurface, color: T.success }}>WA</span>
                      </a>
                    ) : <span style={{ color: T.textMuted }}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[220px] truncate">
                    {r.email ? <a href={`mailto:${r.email}`} className="hover:underline" style={{ color: T.textBody }} title={r.email}>{r.email}</a> : <span style={{ color: T.textMuted }}>—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: T.textBody }} title={r.location || ''}>{r.location || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{CATEGORY_LABEL[r.category] || r.category}</td>
                  <td className="px-4 py-3 text-xs">
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: T.info }} title={r.source_url}>
                      {SOURCES[r.source]?.label || hostOf(r.source_url)}<ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
