'use client';

import { useEffect, useState } from 'react';
import { Plus, X, Globe2 } from 'lucide-react';

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

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};

const EMPTY_FORM = { name: '', url: '', description: '' };

export default function ScraperStatusPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [togglingId, setTogglingId] = useState(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  async function fetchRows() {
    setLoading(true);
    setError(false);
    try {
      const res = await fetch('/api/scraper-registry', { cache: 'no-store' });
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

  function openModal() {
    setForm(EMPTY_FORM);
    setFormErrors({});
    setSubmitError('');
    setModalOpen(true);
  }
  function closeModal() {
    if (submitting) return;
    setModalOpen(false);
  }

  async function submitForm(e) {
    e.preventDefault();
    const name = form.name.trim();
    const url = form.url.trim();
    const errs = {};
    if (!name) errs.name = 'Name is required';
    if (!url) errs.url = 'Website URL is required';
    setFormErrors(errs);
    if (Object.keys(errs).length) return;

    setSubmitting(true);
    setSubmitError('');
    try {
      const res = await fetch('/api/scraper-registry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, url, description: form.description.trim() || null }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setModalOpen(false);
      setForm(EMPTY_FORM);
      await fetchRows();
    } catch (e2) {
      setSubmitError(e2.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStatus(row) {
    const next = row.status === 'running' ? 'pending' : 'running';
    setTogglingId(row.id);
    try {
      const res = await fetch(`/api/scraper-registry/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRows((prev) => prev.map((r) => (r.id === row.id ? json.row : r)));
    } catch {
      // leave row as-is; a subsequent manual refresh will reflect the true state
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Scraper Status</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Proposed and live scraper sources — flip a site to running once it&apos;s built and deployed</p>
        </div>
        <button
          onClick={openModal}
          className="inline-flex items-center gap-1.5 px-4 py-2.5 text-[13px] font-semibold rounded-full shrink-0"
          style={{ background: T.textPrimary, color: T.bgWhite }}
        >
          <Plus className="w-4 h-4" /> Add website
        </button>
      </div>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 560, overflow: 'auto' }}>
          <table className="w-full min-w-[860px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Name', 'Website', 'Status', 'Description', 'Added', ''].map((h, i) => (
                  <th
                    key={i}
                    className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 5 ? 'text-right' : 'text-left'}`}
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
                    {[...Array(6)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '70px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load the scraper registry. Check the DB connection.</td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center">
                    <Globe2 className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No sites yet</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>Add a website to start the submission queue.</p>
                  </td>
                </tr>
              ) : rows.map((r) => (
                <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                  <td className="px-4 py-3 text-[13px] font-medium" style={{ color: T.textPrimary }}>{r.name}</td>
                  <td className="px-4 py-3 text-xs max-w-[220px]">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="truncate block underline"
                      style={{ color: T.textBody }}
                      title={r.url}
                    >
                      {r.url}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className="text-[11px] font-semibold px-2.5 py-1 rounded-full"
                      style={r.status === 'running' ? { background: T.successSurface, color: T.success } : { background: T.warningSurface, color: T.warning }}
                    >
                      {r.status === 'running' ? 'Running' : 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs max-w-[260px] truncate" style={{ color: T.textBody }} title={r.description || ''}>
                    {r.description || '—'}
                  </td>
                  <td className="px-4 py-3 text-xs" style={{ color: T.textMuted }}>{fmtDate(r.created_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => toggleStatus(r)}
                      disabled={togglingId === r.id}
                      className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-60"
                      style={{ borderColor: T.borderLight, color: T.textBody }}
                    >
                      {togglingId === r.id ? '…' : r.status === 'running' ? 'Mark pending' : 'Mark running'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center px-4">
          <div className="absolute inset-0 bg-ink/30 backdrop-blur-sm" onClick={closeModal} />
          <div className="relative w-full max-w-md bg-white p-6" style={CARD}>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold tracking-head" style={{ color: T.textPrimary }}>Add website</h2>
                <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}>Propose a site — it enters the queue as pending</p>
              </div>
              <button onClick={closeModal} aria-label="Close" className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ color: T.textMuted }}>
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={submitForm} className="space-y-3.5">
              <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: T.textSecondary }}>
                Name
                <input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Remax Costa Rica"
                  className="w-full outline-none"
                  style={{ padding: '9px 14px', fontSize: '13px', border: `1px solid ${formErrors.name ? '#C0503A' : T.borderLight}`, borderRadius: '10px', background: T.bgWhite, color: T.textBody }}
                />
                {formErrors.name && <span className="text-[11px] font-normal" style={{ color: '#8A2B16' }}>{formErrors.name}</span>}
              </label>

              <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: T.textSecondary }}>
                Website URL
                <input
                  type="url"
                  value={form.url}
                  onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                  placeholder="https://example.com"
                  className="w-full outline-none"
                  style={{ padding: '9px 14px', fontSize: '13px', border: `1px solid ${formErrors.url ? '#C0503A' : T.borderLight}`, borderRadius: '10px', background: T.bgWhite, color: T.textBody }}
                />
                {formErrors.url && <span className="text-[11px] font-normal" style={{ color: '#8A2B16' }}>{formErrors.url}</span>}
              </label>

              <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: T.textSecondary }}>
                Description / note
                <textarea
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Optional notes for the team"
                  rows={3}
                  className="w-full outline-none resize-none"
                  style={{ padding: '9px 14px', fontSize: '13px', border: `1px solid ${T.borderLight}`, borderRadius: '10px', background: T.bgWhite, color: T.textBody }}
                />
              </label>

              {submitError && (
                <div className="text-xs px-3 py-2 rounded-[10px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>{submitError}</div>
              )}

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="flex-1 px-5 py-2.5 text-[13px] font-semibold rounded-full disabled:opacity-60"
                  style={{ border: `1px solid ${T.borderLight}`, color: T.textPrimary }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="flex-1 px-5 py-2.5 text-[13px] font-semibold rounded-full disabled:opacity-60"
                  style={{ background: T.textPrimary, color: T.bgWhite }}
                >
                  {submitting ? 'Adding…' : 'Add'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
