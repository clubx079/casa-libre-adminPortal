'use client';

import { useEffect, useState } from 'react';
import { ShieldAlert, ExternalLink, ChevronDown } from 'lucide-react';
import { reasonLabel } from '@/lib/ingestLabels';
import { dualPrice, fmtUsd, fmtLocal } from '@/lib/money';
import { currencyFor } from '@/lib/currency';
import { FIXABLE, reasonValue, contactLine } from '@/lib/unverified';

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
  warn: '#8A5A12',
  warnSurface: '#F5EAD5',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
// Looser rule (lib/unverified.js): only no contact, a duplicate of a live listing or an
// unverified seller hold a listing back (Blocked). A bad price, area, bedrooms, bathrooms
// or parking never does: the listing goes live with "Contact seller for …" — those live
// listings are under "Active but incomplete" (not quarantine records).
const VIEWS = [['blocked', 'Blocked'], ['incomplete', 'Active but incomplete']];
const BLOCK_FILTER = ['no_contact', 'duplicate', 'unverified_seller', 'no_images'];
const ON_SITE = {
  active: { label: 'Live on the site (active)', style: { background: '#E4F1E9', color: '#0F6E56' } },
  inactive: { label: 'On the site but inactive', style: { background: '#FAF7F1', color: '#6B6862' } },
};

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};
const shortId = (v) => (v ? String(v).slice(0, 8) : '—');
// Standardized: USD main, the country's own currency as the sub (Gs. / Bs / $U; none
// in Venezuela), converted via that currency's live rate (open.er-api.com).
const money = (p, rate, country) => {
  if (p == null || !Number.isFinite(Number(p.price))) return { usd: '—', pyg: '' };
  const c = currencyFor(country);
  const d = dualPrice(p.price, p.currency, rate || c.fallbackRate, c.code);
  return { usd: fmtUsd(d.usd), pyg: d.pyg == null ? '' : fmtLocal(d.pyg, country) };
};

// Why the AI check rejected a photo (buyer portal lib/scanVerdict.js categories).
const PHOTO_FAIL = { adult: '18+', violence: 'Violence', hate: 'Hateful / abusive', unrelated: 'Not the property' };

export default function QuarantinePage() {
  // Only records still held back are shown (no Released / Discarded lists, no Release:
  // listings go live through the scraper, records can only be discarded here).
  const tab = 'pending';
  const [rows, setRows] = useState([]);
  const [reasonCounts, setReasonCounts] = useState({});
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [rate, setRate] = useState(null);
  const [country, setCountry] = useState('py');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState(null);
  const [actErr, setActErr] = useState('');
  const [reason, setReason] = useState(null); // active reason filter (null = all)
  const [view, setView] = useState('blocked'); // blocked | incomplete
  const [viewCounts, setViewCounts] = useState({});
  const [loose, setLoose] = useState(false);
  const PAGE_SIZE = 50;
  // Language for reason labels — read from the admin's cl_lang cookie (client-side).
  const [lang, setLang] = useState('es');
  useEffect(() => {
    const m = typeof document !== 'undefined' && document.cookie.match(/(?:^|;\s*)cl_lang=(\w+)/);
    if (m && m[1] === 'en') setLang('en');
  }, []);

  async function fetchRows(status, reasonCode, pg, v) {
    setLoading(true); setError(false);
    try {
      const params = new URLSearchParams({ status, page: String(pg), pageSize: String(PAGE_SIZE), view: v || 'blocked' });
      if (reasonCode) params.set('reason', reasonCode);
      const res = await fetch(`/api/quarantine?${params.toString()}`, { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) {
        setRows(json.rows || []);
        setReasonCounts(json.reasonCounts || {});
        setViewCounts(json.viewCounts || {});
        setLoose(!!json.loose);
        setTotal(json.total || 0);
        if (json.rate) setRate(json.rate);
        if (json.country) setCountry(json.country);
      } else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }

  // One effect drives every fetch — view, reason, or page change all refetch.
  useEffect(() => { fetchRows(tab, reason, page, view); }, [reason, page, view]);

  const selectView = (k) => { setView(k); setReason(null); setPage(1); };
  const selectReason = (code) => { setReason(code || null); setPage(1); };

  async function act(row, action) {
    setBusyId(row.id); setActErr('');
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
      else fetchRows(tab, reason, page, view);
    } catch (e) {
      // Surface the failure instead of silently leaving the row in place.
      setActErr(`${action === 'approve' ? 'Approve' : 'Discard'} failed: ${e.message || 'unknown error'}`);
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
            Listings held back before they reach the live site, with what is wrong with each one.
            {loose ? ' A listing is held back (Blocked) for no contact phone, no photos, a duplicate of a live listing, an unverified seller, or photos the AI check rejected (a user’s listing — approve it if the photos are fine). A bad price, area, bedrooms, bathrooms or parking never holds it back: it goes live and the site shows “Contact seller for …” for that field. Those live listings are under Active but incomplete.' : ' Discard a record to remove it from this list.'}
          </p>
        </div>
      </div>

      {actErr ? (
        <div className="text-xs px-4 py-2.5 rounded-[12px] flex items-center justify-between" style={{ background: T.dangerSurface, color: T.danger }}>
          <span>{actErr}</span>
          <button onClick={() => setActErr('')} className="font-semibold ml-3">✕</button>
        </div>
      ) : null}

      {/* All / Blocked / Active but incomplete */}
      {loose && (
        <div className="flex items-center gap-1.5" data-testid="quarantine-views">
          {VIEWS.map(([k, label]) => {
            const on = view === k;
            const n = viewCounts[k];
            const tone = k === 'blocked' ? { background: T.dangerSurface, color: T.danger, borderColor: T.danger } : k === 'incomplete' ? { background: T.warnSurface, color: T.warn, borderColor: T.warn } : { background: '#fff', color: T.textBody, borderColor: T.borderLight };
            return (
              <button key={k} onClick={() => selectView(k)}
                className="inline-flex items-center gap-2 text-[12.5px] font-semibold px-3 py-1.5 rounded-full border transition-colors"
                style={on ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary } : tone}>
                {label}
                {n != null && <span className="text-[11px] font-mono">{n}</span>}
              </button>
            );
          })}
        </div>
      )}

      {/* Reason filter (dropdown) */}
      {reasonList.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textMuted }}>Reason</span>
          <div className="relative inline-block">
            <select
              value={reason || ''}
              onChange={(e) => selectReason(e.target.value)}
              className="appearance-none text-[13px] font-medium pl-3.5 pr-9 py-1.5 rounded-full border outline-none cursor-pointer"
              style={reason
                ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary }
                : { background: '#fff', color: T.textBody, borderColor: T.borderLight }}
            >
              <option value="">All reasons ({viewCounts[view] ?? 0})</option>
              {reasonList.map(([code, n]) => (
                <option key={code} value={code}>{reasonLabel(code, lang)} ({n})</option>
              ))}
            </select>
            <ChevronDown className="w-4 h-4 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              style={{ color: reason ? '#fff' : T.textMuted }} />
          </div>
          {reason && (
            <button onClick={() => selectReason('')} className="text-[12px] font-medium underline" style={{ color: T.textSecondary }}>
              Clear
            </button>
          )}
        </div>
      )}

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="cl-scroll" style={{ maxHeight: 600, overflow: 'auto' }}>
          <table className="w-full min-w-[1080px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Listing', 'Zone', 'Price', view === 'incomplete' ? 'What is incomplete' : 'What is wrong', 'On the site', view === 'incomplete' ? 'Listed' : 'When', 'Action'].map((h, i) => (
                  <th key={i}
                    className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 6 ? 'text-right' : 'text-left'}`}
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
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '140px' : '80px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={7} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load the quarantine queue. Check the DB connection.</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <ShieldAlert className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>
                      {view === 'incomplete' ? (reason ? `No live listings with “${reasonLabel(reason, lang)}”` : 'Every live listing is complete') : reason ? `No held-back records for “${reasonLabel(reason, lang)}”` : 'Nothing held back'}
                    </p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>{view === 'incomplete' ? 'Live listings showing “Contact seller for …” will appear here.' : 'Records the ingest pipeline holds back will appear here.'}</p>
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
                      <div className="font-semibold" style={{ color: T.textPrimary }}>{money(p, rate, country).usd}</div>
                      {money(p, rate, country).pyg && <div className="text-[11px]" style={{ color: T.textMuted }}>{money(p, rate, country).pyg}</div>}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[360px]">
                      <div className="flex flex-wrap gap-1">
                        {(r.reasons || []).map((code) => {
                          const fixable = loose && FIXABLE[code];
                          const val = reasonValue(code, p, rate, country);
                          return (
                            <span key={code} className="inline-flex items-center text-[10px] font-medium px-2 py-0.5 rounded-full"
                              style={fixable ? { background: T.warnSurface, color: T.warn } : code === 'duplicate' ? { background: T.bgSurface, color: T.textSecondary } : { background: T.dangerSurface, color: T.danger }}
                              title={code}>
                              {reasonLabel(code, lang)}{val ? `: ${val}` : ''}
                            </span>
                          );
                        })}
                      </div>
                      {(r.reasons || []).includes('images_rejected') && (
                        <div className="mt-2" data-testid="q-rejected-photos">
                          <div className="flex gap-1.5 flex-wrap">
                            {(p.raw_data?.failed_photos || []).slice(0, 8).map((ph) => (
                              <a key={ph.url || ph.position} href={ph.url} target="_blank" rel="noreferrer" title={PHOTO_FAIL[ph.category] || ph.category}
                                className="relative block w-14 h-14 rounded-[8px] overflow-hidden" style={{ outline: `2px solid ${T.danger}` }}>
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={ph.url} alt="" className="w-full h-full object-cover" />
                                <span className="absolute bottom-0 inset-x-0 text-[8.5px] font-semibold text-white text-center leading-tight py-0.5" style={{ background: 'rgba(140,30,20,.85)' }}>{PHOTO_FAIL[ph.category] || ph.category}</span>
                              </a>
                            ))}
                          </div>
                          {p.raw_data?.user_email && <p className="mt-1 text-[11px]" style={{ color: T.textMuted }}>Seller: {p.raw_data.user_email}</p>}
                        </div>
                      )}
                      {r.state === 'ready' && (
                        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: T.success }} data-testid="q-can-go-live">
                          <b>Can go live.</b>{' '}
                          {r.twin_gone ? 'It was held as a duplicate of a listing that is no longer on the site. ' : ''}
                          {(r.unverified || []).length ? `The site will show: ${r.unverified.map((f) => contactLine(f, lang)).join(' · ')}` : 'Nothing else is wrong with it.'}
                        </p>
                      )}
                      {r.state === 'incomplete' && (
                        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: T.warn }} data-testid="q-incomplete">
                          <b>Live.</b> The site shows: {(r.unverified || []).map((f) => contactLine(f, lang)).join(' · ')}
                        </p>
                      )}
                      {r.state === 'blocked' && (loose || r.duplicate_of) && (
                        <p className="mt-1.5 text-[11px] leading-snug" style={{ color: T.danger }} data-testid="q-blocked">
                          <b>Stays blocked:</b>{' '}
                          {[
                            // the four reasons that block a listing; anything else only if none of them applies
                            ...((r.blocking || []).some((c) => BLOCK_FILTER.includes(c)) ? r.blocking.filter((c) => BLOCK_FILTER.includes(c)) : (r.blocking || [])).map((c) => reasonLabel(c, lang)),
                            ...(r.duplicate_of ? [`Same property as a live listing${r.duplicate_of.source ? ` from ${r.duplicate_of.source}` : ''}${r.duplicate_of.address ? ` (${r.duplicate_of.address})` : ''}`] : []),
                          ].join(' · ')}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {r.on_site ? (
                        <span className="inline-block text-[11px] font-semibold px-2.5 py-1 rounded-full" style={ON_SITE[r.on_site].style}>{ON_SITE[r.on_site].label}</span>
                      ) : (
                        <span className="text-[11px]" style={{ color: T.textMuted }}>Not on the site</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textMuted }}>{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      {r.state === 'incomplete' ? (
                        <a href={r.public_url} target="_blank" rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-full border transition-colors"
                          style={{ borderColor: T.borderLight, color: T.textBody }}>
                          View on site <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <div className="inline-flex gap-1.5">
                          {(r.reasons || []).includes('images_rejected') && (
                            <button onClick={() => act(r, 'approve')} disabled={busyId === r.id} data-testid="q-approve"
                              title="The photos are fine: publish this listing as it is"
                              className="inline-flex items-center text-xs font-semibold px-2.5 py-1.5 rounded-full transition-colors disabled:opacity-60 whitespace-nowrap"
                              style={{ background: T.textPrimary, color: '#fff' }}>
                              {busyId === r.id ? '…' : 'Approve anyway'}
                            </button>
                          )}
                          <button onClick={() => act(r, 'discard')} disabled={busyId === r.id}
                            className="inline-flex items-center text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-60"
                            style={{ borderColor: T.borderLight, color: T.textBody }}>
                            {busyId === r.id ? '…' : 'Discard'}
                          </button>
                        </div>
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
