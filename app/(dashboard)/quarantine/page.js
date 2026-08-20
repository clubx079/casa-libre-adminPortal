'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, ExternalLink } from 'lucide-react';
import { reasonLabel } from '@/lib/ingestLabels';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
  danger: '#B23A3A',
  dangerSurface: '#F6E4E1',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
const TABS = [['pending', 'Pending'], ['released', 'Released'], ['discarded', 'Discarded']];

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};
const shortId = (v) => (v ? String(v).slice(0, 8) : '—');
const money = (p) => {
  if (p == null) return '—';
  const c = String(p.currency || '').toUpperCase();
  const n = Number(p.price);
  if (!Number.isFinite(n)) return '—';
  return (c === 'PYG' ? 'Gs. ' : 'US$ ') + n.toLocaleString('es-PY');
};

export default function QuarantinePage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  // Language for reason labels — read from the admin's cl_lang cookie (client-side).
  const [lang, setLang] = useState('es');
  useEffect(() => {
    const m = typeof document !== 'undefined' && document.cookie.match(/(?:^|;\s*)cl_lang=(\w+)/);
    if (m && m[1] === 'en') setLang('en');
  }, []);

  async function fetchRows(status) {
    setLoading(true); setError(false);
    try {
      const res = await fetch(`/api/quarantine?status=${status}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) { setRows(json.rows || []); setCounts(json.counts || {}); }
      else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  useEffect(() => { fetchRows(tab); }, [tab]);

  async function act(row, action) {
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/quarantine/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // Row leaves the current (pending) view; drop it and adjust counts.
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      setCounts((c) => ({
        ...c,
        [tab]: Math.max(0, (c[tab] || 1) - 1),
        [action === 'release' ? 'released' : 'discarded']: (c[action === 'release' ? 'released' : 'discarded'] || 0) + 1,
      }));
    } catch {
      // leave the row; a manual refresh reflects the true state
    } finally { setBusyId(null); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Quarantine</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>
            Suspect or duplicate scraped records held before they reach the live site. Release to publish, or discard.
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-1.5">
        {TABS.map(([k, label]) => {
          const on = tab === k;
          return (
            <button
              key={k}
              onClick={() => setTab(k)}
              className="inline-flex items-center gap-2 text-[13px] font-medium px-3.5 py-1.5 rounded-full border transition-colors"
              style={on
                ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary }
                : { background: '#fff', color: T.textBody, borderColor: T.borderLight }}
            >
              {label}
              {counts[k] != null && (
                <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-full"
                  style={on ? { background: 'rgba(255,255,255,0.2)' } : { background: T.bgSurface, color: T.textMuted }}>
                  {counts[k]}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="w-full min-w-[1080px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Listing', 'Zone', 'Price', 'Reasons', 'When', tab === 'pending' ? 'Action' : 'Status'].map((h, i) => (
                  <th key={i}
                    className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 5 ? 'text-right' : 'text-left'}`}
                    style={{ color: T.textSecondary, background: T.bgSurface }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(6)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '80px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load the quarantine queue. Check the DB connection.</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <ShieldAlert className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>Nothing {tab}</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>Records the ingest pipeline holds back will appear here.</p>
                  </td>
                </tr>
              ) : rows.map((r) => {
                const p = r.payload || {};
                return (
                  <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3 text-xs max-w-[220px]">
                      <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={p.address || ''}>{p.address || p.property_type || '—'}</p>
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.external_id || shortId(r.source_id)}</p>
                        {p.external_url && (
                          <a href={p.external_url} target="_blank" rel="noreferrer" className="shrink-0" style={{ color: T.textMuted }} title="Open source listing">
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{p.zone_canonical || p.city || p.neighborhood || '—'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textBody }}>{money(p)}</td>
                    <td className="px-4 py-3 text-xs max-w-[320px]">
                      <div className="flex flex-wrap gap-1">
                        {(r.reasons || []).map((code) => (
                          <span key={code} className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full"
                            style={code === 'duplicate' ? { background: T.bgSurface, color: T.textSecondary } : { background: T.dangerSurface, color: T.danger }}
                            title={code}>
                            {reasonLabel(code, lang)}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textMuted }}>{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {tab === 'pending' ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <button onClick={() => act(r, 'release')} disabled={busyId === r.id}
                            className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-60"
                            style={{ borderColor: T.success, color: T.success, background: T.successSurface }}>
                            {busyId === r.id ? '…' : 'Release'}
                          </button>
                          <button onClick={() => act(r, 'discard')} disabled={busyId === r.id}
                            className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-60"
                            style={{ borderColor: T.borderLight, color: T.textBody }}>
                            {busyId === r.id ? '…' : 'Discard'}
                          </button>
                        </div>
                      ) : (
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full capitalize"
                          style={r.status === 'released' ? { background: T.successSurface, color: T.success } : { background: T.bgSurface, color: T.textSecondary }}>
                          {r.status}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
