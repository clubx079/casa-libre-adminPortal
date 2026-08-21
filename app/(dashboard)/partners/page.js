'use client';

import { useEffect, useState } from 'react';
import { Building2, ExternalLink } from 'lucide-react';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  warning: '#8A5A12',
  warningSurface: '#F5EAD5',
  info: '#2A5B8A',
  infoSurface: '#E1ECF5',
  danger: '#B23A3A',
  dangerSurface: '#F6E4E1',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

// Lead lifecycle: new -> contacted -> migrating -> live (or discarded).
const STATUS_LABEL = { new: 'New', contacted: 'Contacted', migrating: 'Migrating', live: 'Live', discarded: 'Discarded' };
const STATUS_ORDER = ['new', 'contacted', 'migrating', 'live', 'discarded'];
const ACTION_LABEL = { new: 'Reopen', contacted: 'Contacted', migrating: 'Migrating', live: 'Live', discarded: 'Discard' };

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};
const waDigits = (p) => {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('595')) return d;
  if (d.startsWith('0')) return '595' + d.slice(1);
  return '595' + d;
};

export default function PartnersPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);
  const [tab, setTab] = useState('all');

  async function fetchRows() {
    setLoading(true); setError(false);
    try {
      const res = await fetch('/api/partners', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setRows(json.rows || []);
      else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { fetchRows(); }, []);

  async function setStatus(row, status) {
    setUpdatingId(row.id);
    try {
      const res = await fetch(`/api/partners/${row.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows((prev) => prev.map((r) => (r.id === row.id ? json.row : r)));
    } catch { /* leave as-is; refresh reflects true state */ }
    finally { setUpdatingId(null); }
  }

  const statusStyle = (s) => {
    if (s === 'live') return { background: T.successSurface, color: T.success };
    if (s === 'migrating') return { background: T.warningSurface, color: T.warning };
    if (s === 'contacted') return { background: T.infoSurface, color: T.info };
    if (s === 'discarded') return { background: T.bgSurface, color: T.textMuted };
    return { background: T.dangerSurface, color: T.danger }; // new
  };

  const counts = STATUS_ORDER.reduce((a, s) => { a[s] = rows.filter((r) => r.status === s).length; return a; }, {});
  const shown = tab === 'all' ? rows : rows.filter((r) => r.status === tab);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Partners</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Business & professional leads from the /empresas page — work them new → contacted → migrating → live.</p>
        </div>
      </div>

      {/* status tabs */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {[['all', 'All'], ...STATUS_ORDER.map((s) => [s, STATUS_LABEL[s]])].map(([k, label]) => {
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

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="w-full min-w-[1100px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Partner', 'Contact', 'Business', 'City', 'Message', 'When', 'Status', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 7 ? 'text-right' : 'text-left'}`}
                    style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(8)].map((__, j) => (<td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '80px', background: T.bgSurface }} /></td>))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={8} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load partner leads. Check the DB connection.</td></tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center">
                    <Building2 className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No {tab === 'all' ? '' : STATUS_LABEL[tab].toLowerCase() + ' '}leads yet</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>Inquiries from the /empresas business page will show up here.</p>
                  </td>
                </tr>
              ) : shown.map((r) => (
                <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                  <td className="px-4 py-3 text-xs max-w-[180px]">
                    <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={r.name || ''}>{r.name || '—'}</p>
                    <p className="text-[11px] truncate" style={{ color: T.textMuted }} title={r.company || ''}>{r.company || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[180px]">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate" style={{ color: T.textBody }}>{r.phone || '—'}</span>
                      {r.phone && (
                        <a href={`https://wa.me/${waDigits(r.phone)}`} target="_blank" rel="noreferrer" className="shrink-0" style={{ color: T.success }} title="WhatsApp"><ExternalLink className="w-3 h-3" /></a>
                      )}
                    </div>
                    <a href={`mailto:${r.email}`} className="text-[11px] font-mono truncate block hover:underline" style={{ color: T.textMuted }} title={r.email || ''}>{r.email || '—'}</a>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[170px]">
                    <p className="truncate" style={{ color: T.textBody }} title={r.business_type || ''}>{r.business_type || '—'}</p>
                    <p className="text-[11px] truncate" style={{ color: T.textMuted }}>{r.portfolio_size || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{r.city || '—'}</td>
                  <td className="px-4 py-3 text-xs max-w-[220px] truncate" style={{ color: T.textBody }} title={r.message || ''}>{r.message || '—'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textMuted }}>{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize" style={statusStyle(r.status)}>{STATUS_LABEL[r.status] || r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {STATUS_ORDER.filter((s) => s !== r.status).map((s) => (
                        <button key={s} onClick={() => setStatus(r, s)} disabled={updatingId === r.id}
                          className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-60"
                          style={{ borderColor: T.borderLight, color: T.textBody }}>
                          {updatingId === r.id ? '…' : ACTION_LABEL[s]}
                        </button>
                      ))}
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
