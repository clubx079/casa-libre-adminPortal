'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, ExternalLink } from 'lucide-react';
import { reasonLabel } from '@/lib/ingestLabels';
import { dualPrice, fmtUsd, fmtPyg } from '@/lib/money';

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
// Standardized: USD main, local ₲ sub, converted via the live rate (open.er-api.com).
const money = (p, rate) => {
  if (p == null || !Number.isFinite(Number(p.price))) return { usd: '—', pyg: '' };
  const d = dualPrice(p.price, p.currency, rate || 7300);
  return { usd: fmtUsd(d.usd), pyg: fmtPyg(d.pyg) };
};

export default function QuarantinePage() {
  const [tab, setTab] = useState('pending');
  const [rows, setRows] = useState([]);
  const [counts, setCounts] = useState({});
  const [reasonCounts, setReasonCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rate, setRate] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [reason, setReason] = useState(null); // active reason filter (null = all)
  const PAGE_SIZE = 50;
  // Language for reason labels — read from the admin's cl_lang cookie (client-side).
  const [lang, setLang] = useState('es');
  useEffect(() => {
    const m = typeof document !== 'undefined' && document.cookie.match(/(?:^|;\s*)cl_lang=(\w+)/);
    if (m && m[1] === 'en') setLang('en');
  }, []);

  async function fetchRows(status, reasonCode, pg) {
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams({ status, page: String(pg), pageSize: String(PAGE_SIZE) });
      if (reasonCode) params.set('reason', reasonCode);
      const res = await fetch(`/api/quarantine?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setRows(json.rows || []);
        setCounts(json.counts || {});
        setReasonCounts(json.reasonCounts || {});
        setTotal(json.total || 0);
        if (json.rate) setRate(json.rate);
      } else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  // One effect drives every fetch — tab, reason, or page change all refetch.
  useEffect(() => { fetchRows(tab, reason, page); }, [tab, reason, page]);

  const selectTab = (k) => { setTab(k); setReason(null); setPage(1); };
  const selectReason = (code) => { setReason((cur) => (cur === code ? null : code)); setPage(1); };

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
      // Row leaves this view; refetch so totals, reason counts and pagination
      // stay exact. Step back a page if we just emptied the last one.
      const nextPage = rows.length === 1 && page > 1 ? page - 1 : page;
      if (nextPage !== page) setPage(nextPage);
      else fetchRows(tab, reason, page);
    } catch {
      // leave the row; a manual refresh reflects the true state
    } finally { setBusyId(null); }
  }

  // Reason chips come from the server (exact counts across the whole status),
  // sorted most-common first. Rows are already server-filtered + paginated.
  const reasonList = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const rangeStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const rangeEnd = Math.min(page * PAGE_SIZE, total);

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
              onClick={() => selectTab(k)}
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

      {/* Reason filters */}
      {reasonList.length > 0 && (
        <div className="flex items-center flex-wrap gap-1.5">
          <span className="text-[11px] font-semibold uppercase tracking-wider mr-1" style={{ color: T.textMuted }}>Reason</span>
          <button
            onClick={() => selectReason(null)}
            className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1 rounded-full border transition-colors"
            style={reason === null
              ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary }
              : { background: '#fff', color: T.textBody, borderColor: T.borderLight }}
          >
            All
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
              style={reason === null ? { background: 'rgba(255,255,255,0.2)' } : { background: T.bgSurface, color: T.textMuted }}>
              {counts[tab] ?? '—'}
            </span>
          </button>
          {reasonList.map(([code, n]) => {
            const on = reason === code;
            return (
              <button
                key={code}
                onClick={() => selectReason(code)}
                title={code}
                className="inline-flex items-center gap-1.5 text-[12px] font-medium px-3 py-1 rounded-full border transition-colors"
                style={on
                  ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary }
                  : { background: '#fff', color: T.textBody, borderColor: T.borderLight }}
              >
                {reasonLabel(code, lang)}
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full"
                  style={on ? { background: 'rgba(255,255,255,0.2)' } : { background: T.bgSurface, color: T.textMuted }}>
                  {n}
                </span>
              </button>
            );
          })}
        </div>
      )}

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
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>
                      {reason ? `No ${tab} records for “${reasonLabel(reason, lang)}”` : `Nothing ${tab}`}
                    </p>
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
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      <div className="font-semibold" style={{ color: T.textPrimary }}>{money(p, rate).usd}</div>
                      {money(p, rate).pyg && <div className="text-[11px]" style={{ color: T.textMuted }}>{money(p, rate).pyg}</div>}
                    </td>
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

      {/* Pagination */}
      {!loading && !error && total > 0 && (
        <div className="flex items-center justify-between flex-wrap gap-3">
          <p className="text-[12px]" style={{ color: T.textSecondary }}>
            Showing <span className="font-semibold" style={{ color: T.textPrimary }}>{rangeStart}–{rangeEnd}</span> of{' '}
            <span className="font-semibold" style={{ color: T.textPrimary }}>{total.toLocaleString()}</span>
            {reason ? <> · <span style={{ color: T.textMuted }}>{reasonLabel(reason, lang)}</span></> : null}
          </p>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setPage(1)} disabled={page <= 1}
              className="text-[12px] font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-40"
              style={{ background: '#fff', color: T.textBody, borderColor: T.borderLight }}>« First</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40"
              style={{ background: '#fff', color: T.textBody, borderColor: T.borderLight }}>‹ Prev</button>
            <span className="text-[12px] font-mono px-3 py-1.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>
              Page {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
              className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors disabled:opacity-40"
              style={{ background: '#fff', color: T.textBody, borderColor: T.borderLight }}>Next ›</button>
            <button
              onClick={() => setPage(totalPages)} disabled={page >= totalPages}
              className="text-[12px] font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-40"
              style={{ background: '#fff', color: T.textBody, borderColor: T.borderLight }}>Last »</button>
          </div>
        </div>
      )}
    </div>
  );
}
