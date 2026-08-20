'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, X, Users as UsersIcon, Activity, CheckCircle2, Circle, Globe, Ban, ShieldOff } from 'lucide-react';

const T = {
  primary: '#111111',
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  warning: '#8A5A12',
  warningSurface: '#F5EAD5',
  danger: '#B3261E',
  dangerSurface: '#FBEAE9',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

// Resolved IP -> geo lookups are cached client-side so re-opening the page
// doesn't re-hit the rate-limited free ip-api.com quota on every load.
const GEO_CACHE_KEY = 'cl_admin_geo_cache_v1';
const GEO_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function loadGeoCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(GEO_CACHE_KEY) || '{}');
    const now = Date.now();
    const fresh = {};
    for (const [ip, entry] of Object.entries(parsed)) {
      if (entry && entry.t && now - entry.t < GEO_TTL_MS) fresh[ip] = entry;
    }
    return fresh;
  } catch { return {}; }
}

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};
const fmtWhen = (v) => {
  if (!v) return 'Never';
  try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); }
  catch { return '—'; }
};

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [geoData, setGeoData] = useState({}); // ip -> { city, state, country }
  const [busy, setBusy] = useState(null); // { id, field } of the in-flight PATCH, or null

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
        const json = await res.json();
        if (!cancelled) {
          if (res.ok) {
            setUsers(json.users || []);
            setCount(json.count || 0);
            fetchGeoData(json.users || []);
          } else setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [term]);

  // Resolve buyer IPs -> city/state/country. The free ip-api.com tier is
  // rate-limited, so we seed from the localStorage cache first (instant,
  // never blank on re-open), then batch-resolve only the un-cached IPs.
  async function fetchGeoData(rows) {
    const uniqueIps = [...new Set(rows.map((u) => u.ip_address).filter(Boolean))];
    if (!uniqueIps.length) return;

    const cache = loadGeoCache();
    const seeded = {};
    for (const ip of uniqueIps) if (cache[ip]) seeded[ip] = cache[ip].geo;
    if (Object.keys(seeded).length) setGeoData((prev) => ({ ...prev, ...seeded }));

    const misses = uniqueIps.filter((ip) => !cache[ip]);
    if (!misses.length) return;
    try {
      const res = await fetch('/api/users/geo-lookup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ips: misses }),
      });
      const data = await res.json(); // { ip: { city, state, country } }
      setGeoData((prev) => ({ ...prev, ...data }));

      const now = Date.now();
      const merged = { ...cache };
      for (const [ip, geo] of Object.entries(data || {})) {
        // Only cache real hits, so failed/rate-limited lookups retry next load.
        if (geo && (geo.city || geo.state || geo.country)) merged[ip] = { geo, t: now };
      }
      try { localStorage.setItem(GEO_CACHE_KEY, JSON.stringify(merged)); } catch {}
    } catch {
      // silently ignore — Location column just shows "—"
    }
  }

  const submit = (e) => { e.preventDefault(); setTerm(q.trim()); };

  // Block / Suspend toggles — PATCH /api/users/:id { [field]: !current }
  async function toggleFlag(u, field) {
    setBusy({ id: u.id, field });
    try {
      const res = await fetch(`/api/users/${u.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [field]: !u[field] }),
      });
      const json = await res.json();
      if (res.ok && json.row) {
        setUsers((prev) => prev.map((x) => (x.id === u.id ? { ...x, ...json.row } : x)));
      }
    } catch {
      // silently ignore — button re-enables, state stays unchanged
    } finally {
      setBusy(null);
    }
  }

  const verifiedCount = users.filter((u) => u.verified).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Users</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Everyone who registered or signed in to the buyer portal</p>
        </div>
      </div>

      {/* Stat strip */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total users', value: count.toLocaleString(), Icon: UsersIcon },
          { label: 'Verified', value: verifiedCount.toLocaleString(), Icon: CheckCircle2 },
          { label: 'Showing', value: users.length.toLocaleString(), Icon: Activity },
        ].map(({ label, value, Icon }) => (
          <div key={label} className="bg-white p-5" style={CARD}>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-medium" style={{ color: T.textSecondary }}>{label}</p>
              <div className="w-9 h-9 flex items-center justify-center" style={{ background: T.bgSurface, borderRadius: '10px' }}>
                <Icon className="w-4 h-4" style={{ color: T.primary }} />
              </div>
            </div>
            <p className="text-3xl font-bold tracking-head" style={{ color: T.textPrimary }}>{loading ? '—' : value}</p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2" style={{ borderColor: T.borderLight }}>
          <form onSubmit={submit} className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T.textMuted }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name or email…"
              className="w-full outline-none"
              style={{
                paddingLeft: '34px', paddingRight: term ? '34px' : '10px',
                paddingTop: '8px', paddingBottom: '8px', fontSize: '13px',
                border: `1px solid ${T.borderLight}`, borderRadius: '999px',
                background: T.bgWhite, color: T.textBody,
              }}
            />
            {term && (
              <button type="button" onClick={() => { setQ(''); setTerm(''); }} className="absolute right-3 top-1/2 -translate-y-1/2">
                <X className="w-3.5 h-3.5" style={{ color: T.textMuted }} />
              </button>
            )}
          </form>
        </div>

        <div className="overflow-x-auto cl-scroll">
          <table className="w-full min-w-[1180px]">
            <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['User', 'Phone', 'IP', 'Location', 'Method', 'Status', 'Joined', 'Last login', 'Actions'].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i >= 8 ? 'text-right' : 'text-left'}`} style={{ color: T.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(9)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '160px' : '70px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan="9" className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load users. Check the DB connection.</td></tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="9" className="px-6 py-12 text-center">
                    <UsersIcon className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No users found</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>{term ? 'Try a different search.' : 'Users appear here once people sign in to the buyer portal.'}</p>
                  </td>
                </tr>
              ) : users.map((u) => {
                const name = u.full_name || '—';
                const initial = (u.full_name || u.email || '?').trim().charAt(0).toUpperCase();
                return (
                  <tr key={u.id} className="border-b transition-colors" style={{ borderColor: T.borderLight }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = T.bgSurface)}
                    onMouseLeave={(e) => (e.currentTarget.style.background = T.bgWhite)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center text-[13px] font-bold">{initial}</span>
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }}>{name}</p>
                          <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{u.phone || '—'}</td>
                    <td className="px-4 py-3">
                      {u.ip_address ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-mono" style={{ color: T.textBody }}>
                          <Globe className="w-3 h-3 shrink-0" style={{ color: T.textMuted }} />
                          {u.ip_address}
                        </span>
                      ) : (
                        <span className="text-xs" style={{ color: T.textMuted }}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textBody }}>
                      {(() => {
                        const geo = u.ip_address ? geoData[u.ip_address] : null;
                        if (!geo || (!geo.city && !geo.state && !geo.country)) {
                          return <span style={{ color: T.textMuted }}>—</span>;
                        }
                        const place = [geo.city, geo.state].filter(Boolean).join(', ');
                        return (
                          <>
                            {place || '—'}
                            {geo.country && <span className="ml-1 text-[10px]" style={{ color: T.textMuted }}>{geo.country}</span>}
                          </>
                        );
                      })()}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>
                        {u.auth_provider === 'google' ? 'Google' : 'Email'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.blocked ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: T.dangerSurface, color: T.danger }}><Ban className="w-3 h-3" /> Blocked</span>
                      ) : u.suspended ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: T.warningSurface, color: T.warning }}><ShieldOff className="w-3 h-3" /> Suspended</span>
                      ) : u.active === false ? (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}><Circle className="w-3 h-3" /> Inactive</span>
                      ) : u.verified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: T.successSurface, color: T.success }}><CheckCircle2 className="w-3 h-3" /> Verified</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}><Circle className="w-3 h-3" /> Unverified</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textMuted }}>{fmtWhen(u.last_login_at)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/analytics?user=${encodeURIComponent(u.id)}&email=${encodeURIComponent(u.email || '')}`}
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors"
                          style={{ borderColor: T.borderLight, color: T.textBody }}>
                          <Activity className="w-3.5 h-3.5" /> Activity
                        </Link>
                        <button
                          type="button"
                          onClick={() => toggleFlag(u, 'suspended')}
                          disabled={busy?.id === u.id}
                          className="text-[11px] font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50"
                          style={{
                            borderColor: u.suspended ? T.borderLight : '#E9CFA0',
                            background: u.suspended ? T.bgWhite : T.warningSurface,
                            color: u.suspended ? T.textBody : T.warning,
                          }}
                        >
                          {busy?.id === u.id && busy?.field === 'suspended' ? '…' : u.suspended ? 'Unsuspend' : 'Suspend'}
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleFlag(u, 'blocked')}
                          disabled={busy?.id === u.id}
                          className="text-[11px] font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50"
                          style={{
                            borderColor: u.blocked ? T.borderLight : '#F0BDB6',
                            background: u.blocked ? T.bgWhite : T.dangerSurface,
                            color: u.blocked ? T.textBody : T.danger,
                          }}
                        >
                          {busy?.id === u.id && busy?.field === 'blocked' ? '…' : u.blocked ? 'Unblock' : 'Block'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px]" style={{ color: T.textMuted }}>Showing up to 500 most recent users. Activity opens their PostHog session timeline.</p>
    </div>
  );
}
