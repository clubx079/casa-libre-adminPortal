'use client';

import { useEffect, useMemo, useState } from 'react';
import { Target, ExternalLink, Search } from 'lucide-react';
import { LEAD_STATUSES, STATUS_LABEL, CATEGORY_LABEL, SOURCES, waDigits, filterLeads, hasContact } from '@/lib/potentialLeads';

const T = {
  textPrimary: '#111111', textBody: '#3A3A37', textSecondary: '#6B6862', textMuted: '#9C978C',
  borderLight: '#E7E1D6', bgSurface: '#FAF7F1',
  success: '#0F6E56', successSurface: '#E4F1E9', warning: '#8A5A12', warningSurface: '#F5EAD5',
  info: '#2A5B8A', infoSurface: '#E1ECF5', danger: '#B23A3A', dangerSurface: '#F6E4E1',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
const ACTION_LABEL = { new: 'Reopen', contacted: 'Contacted', interested: 'Interested', client: 'Client', discarded: 'Discard' };
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const statusStyle = (s) => {
  if (s === 'client') return { background: T.successSurface, color: T.success };
  if (s === 'interested') return { background: T.warningSurface, color: T.warning };
  if (s === 'contacted') return { background: T.infoSurface, color: T.info };
  if (s === 'discarded') return { background: T.bgSurface, color: T.textMuted };
  return { background: T.dangerSurface, color: T.danger };   // new
};

export default function LeadsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  const [country, setCountry] = useState('');
  const [tab, setTab] = useState('all');
  const [contact, setContact] = useState('all');
  const [q, setQ] = useState('');
  const [updatingId, setUpdatingId] = useState(null);

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

  async function setStatus(row, status) {
    setUpdatingId(row.id);
    try {
      const res = await fetch(`/api/leads/${row.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
      const json = await res.json();
      if (res.ok) setRows((prev) => prev.map((r) => (r.id === row.id ? json.row : r)));
    } finally { setUpdatingId(null); }
  }

  async function deleteRow(row) {
    if (!window.confirm(`Delete "${row.name}" for good? This can't be undone.`)) return;
    setUpdatingId(row.id);
    try {
      const res = await fetch(`/api/leads/${row.id}`, { method: 'DELETE' });
      if (res.ok) setRows((prev) => prev.filter((r) => r.id !== row.id));
    } finally { setUpdatingId(null); }
  }

  const counts = useMemo(() => LEAD_STATUSES.reduce((a, s) => { a[s] = rows.filter((r) => r.status === s).length; return a; }, {}), [rows]);
  const withContact = rows.filter(hasContact).length;
  const shown = filterLeads(rows, { q, status: tab, contact });
  const sources = [...new Set(rows.map((r) => r.source))];

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Leads</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>
            Potential clients we found ourselves — developers and businesses to contact once the marketplace has traffic.
          </p>
        </div>
        {rows.length > 0 && (
          <div className="flex items-center gap-4 text-[12px]" style={{ color: T.textSecondary }}>
            <span><b style={{ color: T.textPrimary }}>{rows.length}</b> leads</span>
            <span><b style={{ color: T.textPrimary }}>{withContact}</b> with contact</span>
            {sources.map((s) => (
              <a key={s} href={SOURCES[s]?.list || '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline">
                Source: {SOURCES[s]?.label || s}<ExternalLink className="w-3 h-3" />
              </a>
            ))}
          </div>
        )}
      </div>

      {/* status tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[['all', 'All'], ...LEAD_STATUSES.map((s) => [s, STATUS_LABEL[s]])].map(([k, label]) => {
          const on = tab === k;
          const n = k === 'all' ? rows.length : counts[k];
          return (
            <button key={k} onClick={() => setTab(k)}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-3.5 py-1.5 rounded-full border transition-colors"
              style={on ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary } : { background: '#fff', color: T.textBody, borderColor: T.borderLight }}>
              {label}
              <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full" style={on ? { background: 'rgba(255,255,255,0.2)' } : { background: T.bgSurface, color: T.textMuted }}>{n}</span>
            </button>
          );
        })}
      </div>

      {/* search + contact filter */}
      <div className="flex flex-col sm:flex-row gap-2">
        <label className="flex-1 flex items-center gap-2 px-3 py-2 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }}>
          <Search className="w-4 h-4" style={{ color: T.textMuted }} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, location, phone…" className="flex-1 bg-transparent outline-none text-[13px]" />
        </label>
        <div className="flex items-center gap-1 p-1 bg-white rounded-full" style={{ border: `1px solid ${T.borderLight}` }}>
          {[['all', 'All'], ['with', 'With contact'], ['without', 'No contact']].map(([k, label]) => (
            <button key={k} onClick={() => setContact(k)} className="px-3 py-1 rounded-full text-[12.5px] font-medium"
              style={contact === k ? { background: T.textPrimary, color: '#fff' } : { color: T.textBody }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 640, overflow: 'auto' }}>
          <table className="w-full min-w-[1050px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Lead', 'Phone / WhatsApp', 'Location', 'Type', 'Source', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 6 ? 'text-right' : 'text-left'}`} style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
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
                    {r.legal_name && <p className="text-[11px] truncate" style={{ color: T.textMuted }} title={r.legal_name}>{r.legal_name}</p>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {[r.phone, r.whatsapp].filter(Boolean).length ? (
                      <div className="space-y-0.5">
                        {[r.phone, r.whatsapp !== r.phone ? r.whatsapp : null].filter(Boolean).map((p) => (
                          <div key={p} className="flex items-center gap-1.5">
                            <a href={`tel:${p.replace(/\s/g, '')}`} className="hover:underline whitespace-nowrap" style={{ color: T.textBody }}>{p}</a>
                            <a href={`https://wa.me/${waDigits(p)}`} target="_blank" rel="noreferrer" title="Open in WhatsApp" className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full" style={{ background: T.successSurface, color: T.success }}>WA</a>
                          </div>
                        ))}
                      </div>
                    ) : <span style={{ color: T.textMuted }}>—</span>}
                    {r.email && <a href={`mailto:${r.email}`} className="block text-[11px] font-mono truncate hover:underline" style={{ color: T.textMuted }}>{r.email}</a>}
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: T.textBody }} title={r.location || ''}>{r.location || '—'}</td>
                  <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{CATEGORY_LABEL[r.category] || r.category}</td>
                  <td className="px-4 py-3 text-xs">
                    <a href={r.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:underline" style={{ color: T.info }} title={r.source_url}>
                      {SOURCES[r.source]?.label || hostOf(r.source_url)}<ExternalLink className="w-3 h-3" />
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={statusStyle(r.status)}>{STATUS_LABEL[r.status] || r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {LEAD_STATUSES.filter((s) => s !== r.status).map((s) => (
                        <button key={s} onClick={() => setStatus(r, s)} disabled={updatingId === r.id}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-full border disabled:opacity-60" style={{ borderColor: T.borderLight, color: T.textBody }}>
                          {updatingId === r.id ? '…' : ACTION_LABEL[s]}
                        </button>
                      ))}
                      {r.status === 'discarded' && (
                        <button onClick={() => deleteRow(r)} disabled={updatingId === r.id}
                          className="text-xs font-medium px-2.5 py-1.5 rounded-full border disabled:opacity-60" style={{ borderColor: T.danger, color: T.danger }}>Delete</button>
                      )}
                    </div>
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
