'use client';

import { useEffect, useState } from 'react';
import { Flag, User } from 'lucide-react';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
  bgWhite: '#FFFFFF',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  warning: '#8A5A12',
  warningSurface: '#F5EAD5',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const STATUS_LABEL = { open: 'Open', reviewed: 'Reviewed', resolved: 'Resolved' };
const STATUS_ORDER = ['open', 'reviewed', 'resolved'];

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};

const shortId = (v) => (v ? String(v).slice(0, 8) : '—');

export default function ReportsPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [updatingId, setUpdatingId] = useState(null);

  async function fetchRows() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/reports', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setRows(json.rows || []);
      else setError(true);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchRows(); }, []);

  async function setStatus(row, status) {
    setUpdatingId(row.id);
    try {
      const res = await fetch(`/api/reports/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows((prev) => prev.map((r) => (r.id === row.id ? json.row : r)));
    } catch {
      // leave row as-is; a subsequent manual refresh will reflect the true state
    } finally {
      setUpdatingId(null);
    }
  }

  const statusStyle = (status) => {
    if (status === 'resolved') return { background: T.successSurface, color: T.success };
    if (status === 'reviewed') return { background: T.bgSurface, color: T.textPrimary };
    return { background: T.warningSurface, color: T.warning };
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Reports</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Buyers who reported a publisher that didn&apos;t respond</p>
        </div>
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 560, overflow: 'auto' }}>
          <table className="w-full min-w-[1080px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Listing', 'Seller', 'Reporter', 'Message', 'When', 'Status', ''].map((h, i) => (
                  <th
                    key={i}
                    className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 6 ? 'text-right' : 'text-left'}`}
                    style={{ color: T.textSecondary, background: T.bgSurface }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '80px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load reports. Check the DB connection.</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Flag className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No reports yet</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>No-response reports from buyers will show up here.</p>
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                  <td className="px-4 py-3 text-xs max-w-[160px]">
                    <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={r.listing_ref || ''}>{r.listing_ref || '—'}</p>
                    <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{shortId(r.property_id)}</p>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[160px]">
                    <p className="truncate" style={{ color: T.textBody }} title={r.seller_name || ''}>{r.seller_name || '—'}</p>
                    <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.seller_phone || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[180px]">
                    <p className="truncate" style={{ color: T.textBody }} title={r.reporter_name || ''}>{r.reporter_name || '—'}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.reporter_contact || '—'}</p>
                      {r.user_id ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full shrink-0" style={{ background: T.bgSurface, color: T.textSecondary }}>
                          <User className="w-2.5 h-2.5" /> account
                        </span>
                      ) : (
                        <span className="text-[10px] shrink-0" style={{ color: T.textMuted }}>anonymous</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[240px] truncate" style={{ color: T.textBody }} title={r.message || ''}>
                    {r.message || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: T.textMuted }}>{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={statusStyle(r.status)}>
                      {STATUS_LABEL[r.status] || r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1.5 flex-wrap">
                      {STATUS_ORDER.filter((s) => s !== r.status).map((s) => (
                        <button
                          key={s}
                          onClick={() => setStatus(r, s)}
                          disabled={updatingId === r.id}
                          className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-60"
                          style={{ borderColor: T.borderLight, color: T.textBody }}
                        >
                          {updatingId === r.id ? '…' : s === 'open' ? 'Reopen' : `Mark ${s}`}
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
