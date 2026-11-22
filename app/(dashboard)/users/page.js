'use client';

import { useEffect, useState } from 'react';
import { LISTING_FREE_LIMIT } from '@/lib/listingCount';
import Link from 'next/link';
import { Search, X, Users as UsersIcon, Activity, Home, CheckCircle2, Circle, Globe, Ban, ShieldOff, Trash2 } from 'lucide-react';

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

// How the person signs in: WhatsApp sign-ups are auth_provider 'whatsapp' (email not
// confirmed yet) / 'whatsapp_email' (confirmed); an email or Google account that also
// verified a WhatsApp shows both.
function signInMethod(u) {
  const p = String(u.auth_provider || '');
  if (p === 'whatsapp' || p === 'whatsapp_email') return 'WhatsApp';
  const base = p === 'google' ? 'Google' : p === 'apple' ? 'Apple' : 'Email';
  return u.phone_verified_at ? `${base} + WhatsApp` : base;
}

// Profile Personalization (website Settings): only what the user SAVED there — "2/6" or
// "Complete" + a small bar (red < 2, yellow 2–4, green 5–6); confirmed WhatsApp shown apart.
// "Personalized" = the emails' stop rule.
const PROFILE_TONE = { red: '#DC2626', yellow: '#F59E0B', green: '#16A34A' };
const PROFILE_LABEL = { photo: 'photo', first_name: 'first name', last_name: 'last name', job_title: 'title', company_name: 'company', company_website: 'website', whatsapp: 'WhatsApp' };
function ProfileCell({ p }) {
  if (!p) return <span className="text-xs" style={{ color: T.textMuted }}>—</span>;
  const done = p.count === p.total;
  const color = PROFILE_TONE[p.tone] || PROFILE_TONE.red;
  return (
    <div className="w-[92px]" title={done ? 'All 6 profile items saved' : p.count === 0 ? 'Not started (nothing saved in Profile Personalization)' : `Missing: ${p.missing.map((k) => PROFILE_LABEL[k] || k).join(', ')}`} data-testid="profile-cell">
      <div className="flex items-baseline justify-between gap-1">
        <span className="text-[12px] font-semibold tabular-nums" style={{ color: done ? PROFILE_TONE.green : T.textBody }}>{done ? 'Complete' : `${p.count}/${p.total}`}</span>
        {p.personalized && !done ? <span className="text-[9.5px] font-semibold uppercase" style={{ color: PROFILE_TONE.green }}>OK</span> : null}
      </div>
      <div className="h-1.5 mt-1 rounded-full overflow-hidden" style={{ background: T.bgSurface }}>
        <div className="h-full rounded-full" style={{ width: `${Math.max(p.pct, 4)}%`, background: color }} />
      </div>
      <div className="text-[10.5px] mt-1" style={{ color: p.whatsapp ? PROFILE_TONE.green : T.textMuted }}>{p.whatsapp ? '✓ WhatsApp' : 'No WhatsApp'}</div>
    </div>
  );
}

// Buyer or seller (website lib/userType.js, admin lib/userTypeAdmin.js).
const TYPE_STYLE = {
  seller_listed: { label: 'Seller', detail: 'listed', bg: '#E4F1E9', fg: '#0F6E56', bar: '#0F6E56' },
  seller_never_listed: { label: 'Seller', detail: 'never listed', bg: '#F5EAD5', fg: '#8A5A12', bar: '#D9A54A' },
  buyer: { label: 'Buyer', detail: null, bg: '#E8EEF8', fg: '#2B4C7E', bar: '#2B4C7E' },
  buyer_listed: { label: 'Buyer', detail: 'who listed', bg: '#EEE8F8', fg: '#5B3E8F', bar: '#8B6CC4' },
  unknown: { label: 'Not known', detail: null, bg: '#FAF7F1', fg: '#9C978C', bar: '#E7E1D6' },
};
const SOURCE_TEXT = {
  sell_funnel: 'Signed up in the sell form', app_sell: 'Signed up from the app Sell button', signup_choice: 'Answered after sign-up',
  login_choice: 'Picked on the log-in screen', listing: 'Published a listing (type was empty)',
  backfill_listed: 'Backfill: has listed', backfill_sell_funnel: 'Backfill: signed up in the sell form',
  backfill_draft: 'Backfill: started a listing draft', backfill_login: 'Backfill: signed up from Log in, never listed',
};
function TypeCell({ t }) {
  const s = TYPE_STYLE[t?.group] || TYPE_STYLE.unknown;
  return (
    <span className="inline-flex flex-col items-start gap-0.5" title={t?.source ? SOURCE_TEXT[t.source] || t.source : 'No type yet (still gets every email)'} data-testid="type-cell">
      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap" style={{ background: s.bg, color: s.fg }}>{s.label}</span>
      {s.detail && <span className="text-[10.5px] whitespace-nowrap" style={{ color: T.textMuted }}>{s.detail}</span>}
    </span>
  );
}
// Summary next to the tiles: % sellers / % buyers over accounts with a type, a bar of the 4 groups.
function TypeShares({ s, ready, loading }) {
  const c = s?.counts || {};
  const groups = ['seller_listed', 'seller_never_listed', 'buyer_listed', 'buyer'];
  const tip = (g) => `${TYPE_STYLE[g].label}${TYPE_STYLE[g].detail ? ' · ' + TYPE_STYLE[g].detail : ''}: ${c[g]}`;
  return (
    <div className="bg-white p-5 col-span-2" style={CARD} data-testid="type-shares">
      <p className="text-xs font-medium" style={{ color: T.textSecondary }}>Sellers and buyers</p>
      {loading ? <p className="text-3xl font-bold mt-3">—</p> : !ready || !s ? (
        <p className="text-[12px] mt-3" style={{ color: T.textMuted }}>Not set up yet: run website migration 023_user_type.sql, then the backfill.</p>
      ) : (
        <>
          <div className="flex items-baseline gap-4 mt-2 flex-wrap">
            <p className="text-3xl font-bold tracking-head" style={{ color: T.textPrimary }}>{s.pctSellers}%<span className="text-[13px] font-medium ml-1" style={{ color: T.textSecondary }}>sellers</span></p>
            <p className="text-3xl font-bold tracking-head" style={{ color: T.textPrimary }}>{s.pctBuyers}%<span className="text-[13px] font-medium ml-1" style={{ color: T.textSecondary }}>buyers</span></p>
          </div>
          <div className="flex h-2 mt-3 rounded-full overflow-hidden" style={{ background: T.bgSurface }}>
            {groups.map((g) => (s.known && c[g] ? <div key={g} style={{ width: `${(c[g] / s.known) * 100}%`, background: TYPE_STYLE[g].bar }} title={tip(g)} /> : null))}
          </div>
          <p className="text-[11px] mt-2 leading-snug" style={{ color: T.textMuted }}>
            {s.pctSellersNeverListed}% of sellers never listed · {s.pctBuyersListed}% of buyers listed · {(c.seller_listed || 0) + (c.seller_never_listed || 0)} sellers, {(c.buyer || 0) + (c.buyer_listed || 0)} buyers{c.unknown ? ` · ${c.unknown} not known yet` : ''}
          </p>
        </>
      )}
    </div>
  );
}

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [count, setCount] = useState(0);
  const [stats, setStats] = useState(null); // { total, verified, verifiedWithListing, pctVerifiedWithListing } for the whole country
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [pfilter, setPfilter] = useState('');   // profile filter (api/users ?profile=)
  const [tfilter, setTfilter] = useState('');   // buyer / seller filter (api/users ?type=)
  const [geoData, setGeoData] = useState({}); // ip -> { city, state, country }
  const [busy, setBusy] = useState(null); // { id, field } of the in-flight PATCH, or null
  const [confirmUser, setConfirmUser] = useState(null); // user pending delete confirmation (opens the modal)
  const [delErr, setDelErr] = useState(null);           // delete error, shown inside the modal

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    (async () => {
      try {
        const qs = new URLSearchParams();
        if (term) qs.set('q', term);
        if (pfilter) qs.set('profile', pfilter);
        if (tfilter) qs.set('type', tfilter);
        const res = await fetch(`/api/users${qs.toString() ? `?${qs}` : ''}`);
        const json = await res.json();
        if (!cancelled) {
          if (res.ok) {
            setUsers(json.users || []);
            setCount(json.count || 0);
            setStats(json.stats || null);
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
  }, [term, pfilter, tfilter]);

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
  // Search as you type: a short pause after the last key (Enter still searches at once).
  useEffect(() => { const t = setTimeout(() => setTerm(q.trim()), 300); return () => clearTimeout(t); }, [q]);

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

  // Permanently delete a user (admin cleanup of test accounts). Destructive, so the
  // row's Delete button opens a styled confirmation modal (below); confirmDelete()
  // runs the actual DELETE and removes the row from the table on success.
  async function confirmDelete() {
    const u = confirmUser;
    if (!u) return;
    setDelErr(null);
    setBusy({ id: u.id, field: 'delete' });
    try {
      const res = await fetch(`/api/users/${u.id}`, { method: 'DELETE' });
      if (res.ok) {
        setUsers((prev) => prev.filter((x) => x.id !== u.id));
        setCount((c) => Math.max(0, c - 1));
        setStats((st) => st && (() => {
          const verified = st.verified - (u.verified ? 1 : 0);
          const verifiedWithListing = st.verifiedWithListing - (u.verified && u.listings > 0 ? 1 : 0);
          return { total: Math.max(0, st.total - 1), verified, verifiedWithListing, pctVerifiedWithListing: verified ? Math.round((verifiedWithListing / verified) * 100) : null };
        })());
        setConfirmUser(null);
      } else {
        const j = await res.json().catch(() => ({}));
        setDelErr(`Couldn't delete: ${j.error || res.status}`);
      }
    } catch (e) {
      setDelErr(`Couldn't delete: ${String(e.message || e)}`);
    } finally {
      setBusy(null);
    }
  }

  // Whole-country numbers from the API (all users, not only the 500 rows / search
  // results in the table); falls back to the loaded rows if the summary failed.
  const verifiedCount = stats ? stats.verified : users.filter((u) => u.verified).length;
  const totalCount = stats ? stats.total : count;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Users</h1>
          <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Everyone who registered or signed in to the buyer portal</p>
        </div>
      </div>

      {/* Stat strip — totals for the active country */}
      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
        {[
          { label: 'Total users', value: totalCount.toLocaleString(), Icon: UsersIcon },
          { label: 'Verified users', value: verifiedCount.toLocaleString(), Icon: CheckCircle2 },
          {
            label: 'Verified with a listing',
            value: stats && stats.pctVerifiedWithListing != null ? `${stats.pctVerifiedWithListing}%` : '—',
            hint: stats ? `${stats.verifiedWithListing.toLocaleString()} of ${stats.verified.toLocaleString()} verified users` : null,
            Icon: Home,
          },
          {
            // Profile Personalization: photo or logo + first & last name + title or company (or 7/7)
            label: 'Verified with a personalized profile',
            value: stats && stats.pctVerifiedPersonalized != null ? `${stats.pctVerifiedPersonalized}%` : '—',
            hint: stats && stats.verifiedPersonalized != null ? `${stats.verifiedPersonalized.toLocaleString()} of ${stats.verified.toLocaleString()} verified · photo + name + title or company` : null,
            Icon: CheckCircle2,
          },
          { label: 'Showing', value: users.length.toLocaleString(), Icon: Activity },
        ].map(({ label, value, hint, Icon }) => (
          <div key={label} className="bg-white p-5" style={CARD}>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xs font-medium" style={{ color: T.textSecondary }}>{label}</p>
              <div className="w-9 h-9 flex items-center justify-center" style={{ background: T.bgSurface, borderRadius: '10px' }}>
                <Icon className="w-4 h-4" style={{ color: T.primary }} />
              </div>
            </div>
            <p className="text-3xl font-bold tracking-head" style={{ color: T.textPrimary }}>{loading ? '—' : value}</p>
            {hint && !loading && <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>{hint}</p>}
          </div>
        ))}
        <TypeShares s={stats?.types} ready={!!stats?.typesReady} loading={loading} />
      </div>

      {/* Table */}
      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="px-4 py-3 border-b flex flex-wrap items-center gap-2" style={{ borderColor: T.borderLight }}>
          <form onSubmit={submit} className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5" style={{ color: T.textMuted }} />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by name, email or phone…"
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
          {/* Profile Personalization filter — on every account of the country, not only the rows shown */}
          <select value={pfilter} onChange={(e) => setPfilter(e.target.value)} aria-label="Filter by profile"
            className="outline-none text-[13px]" style={{ padding: '8px 12px', border: `1px solid ${T.borderLight}`, borderRadius: '999px', background: T.bgWhite, color: T.textBody }}>
            <option value="">All users</option>
            <option value="personalized">Personalized profile</option>
            <option value="not_personalized">Not personalized</option>
            <option value="photo">With a profile photo</option>
            <option value="face">Photo: real face</option>
            <option value="logo">Photo: logo, text or other</option>
            <option value="no_photo">No profile photo</option>
          </select>
          {/* Buyer or seller filter, on every account of the country */}
          <select value={tfilter} onChange={(e) => setTfilter(e.target.value)} aria-label="Filter by type" data-testid="type-filter"
            className="outline-none text-[13px]" style={{ padding: '8px 12px', border: `1px solid ${T.borderLight}`, borderRadius: '999px', background: T.bgWhite, color: T.textBody }}>
            <option value="">All types</option>
            <option value="seller">Sellers</option>
            <option value="seller_listed">Sellers · listed</option>
            <option value="seller_never_listed">Sellers · never listed</option>
            <option value="buyer">Buyers</option>
            <option value="buyer_only">Buyers · never listed</option>
            <option value="buyer_listed">Buyers who listed</option>
            <option value="unknown">Type not known</option>
          </select>
        </div>

        <div className="overflow-x-auto cl-scroll">
          <table className="w-full min-w-[1280px]">
            <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['User', 'Type', 'Phone', 'IP', 'Location', 'Method', 'Status', 'Listings', 'Profile', 'Joined', 'Last login', 'Actions'].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i >= 11 ? 'text-right' : i === 7 ? 'text-center' : 'text-left'}`} style={{ color: T.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(12)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '160px' : '70px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan="12" className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load users. Check the DB connection.</td></tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="12" className="px-6 py-12 text-center">
                    <UsersIcon className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No users found</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>{term || pfilter || tfilter ? 'Try a different search or filter.' : 'Users appear here once people sign in to the buyer portal.'}</p>
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
                        {u.photo?.url ? (
                          // their approved profile photo (Profile Personalization); a small badge when it isn't a face
                          <span className="relative w-8 h-8 shrink-0" title={u.photo.kind === 'face' ? 'Profile photo: real face' : u.photo.kind === 'logo' ? 'Profile photo: logo or text' : u.photo.kind === 'other' ? 'Profile photo: not a face' : 'Profile photo'}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={u.photo.url} alt="" loading="lazy" className="w-8 h-8 rounded-full object-cover" style={{ border: `1px solid ${T.borderLight}`, background: T.bgSurface }} />
                            {u.photo.kind && u.photo.kind !== 'face' ? <span className="absolute -bottom-1 -right-1 text-[8px] font-bold px-1 rounded-full" style={{ background: T.warningSurface, color: T.warning, border: '1px solid #fff' }}>{u.photo.kind === 'logo' ? 'LOGO' : '?'}</span> : null}
                          </span>
                        ) : (
                          <span className="w-8 h-8 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center text-[13px] font-bold">{initial}</span>
                        )}
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }}>{name}</p>
                          <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{u.email}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3"><TypeCell t={u.type} /></td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>
                      {u.phone || '—'}
                      {u.phone_source === 'listing' ? <span className="block text-[10px]" style={{ color: T.textMuted }}>from listing</span> : null}
                    </td>
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
                        {signInMethod(u)}
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
                    {/* listings this user published; flagged from the free limit on (LISTING_FREE_LIMIT, 3) */}
                    <td className="px-4 py-3 text-center text-xs">
                      {u.listings >= LISTING_FREE_LIMIT ? (
                        <span className="inline-block px-2 py-0.5 rounded-full font-semibold" style={{ background: '#F5EAD5', color: '#8A5A12' }} title={`${LISTING_FREE_LIMIT}+ listings — at or over the free listings per month`}>{u.listings}</span>
                      ) : <span style={{ color: u.listings ? T.textBody : T.textMuted }}>{u.listings || 0}</span>}
                      {u.listings_waiting > 0 && <span className="block text-[10.5px] mt-0.5 whitespace-nowrap" style={{ color: '#8A5A12' }} title="Saved over the free limit, not paid — not on the site">+{u.listings_waiting} waiting for payment</span>}
                      {u.listings_deleted > 0 && <span className="block text-[10.5px] mt-0.5 whitespace-nowrap" style={{ color: T.textMuted }} title="Listings they (or the team) deleted — still counted in the free listings of their month">{u.listings_deleted} deleted</span>}
                    </td>
                    <td className="px-4 py-3"><ProfileCell p={u.profile} /></td>
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
                        <button
                          type="button"
                          onClick={() => { setDelErr(null); setConfirmUser(u); }}
                          disabled={busy?.id === u.id}
                          title="Delete user permanently"
                          className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-50"
                          style={{ borderColor: '#F0BDB6', background: T.bgWhite, color: T.danger }}
                        >
                          {busy?.id === u.id && busy?.field === 'delete' ? '…' : (<><Trash2 className="w-3.5 h-3.5" /> Delete</>)}
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

      <p className="text-[11px]" style={{ color: T.textMuted }}>Showing up to 500 most recent users. Deleted accounts are hidden. Activity opens their PostHog session timeline.</p>

      {/* Delete confirmation modal — replaces the browser's native confirm(). */}
      {confirmUser && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center p-4"
          style={{ background: 'rgba(17,17,17,0.45)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
          onClick={() => { if (busy?.field !== 'delete') setConfirmUser(null); }}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-md bg-white p-6"
            style={{ ...CARD, boxShadow: '0 24px 60px rgba(17,17,17,0.28)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start gap-3.5">
              <div className="w-11 h-11 shrink-0 flex items-center justify-center rounded-full" style={{ background: T.dangerSurface }}>
                <Trash2 className="w-5 h-5" style={{ color: T.danger }} />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-[16px] font-bold tracking-head" style={{ color: T.textPrimary }}>Delete user</h3>
                <p className="text-[13px] mt-1.5 leading-relaxed" style={{ color: T.textSecondary }}>
                  Delete{' '}
                  <span className="font-semibold break-all" style={{ color: T.textPrimary }}>{confirmUser.email || confirmUser.full_name || 'this user'}</span>?
                  {' '}This permanently removes the account and cannot be undone. Their published listings, if any, are kept.
                </p>
                {delErr && (
                  <p className="text-[12px] mt-3 px-3 py-2 rounded-[10px]" style={{ background: T.dangerSurface, color: T.danger }}>{delErr}</p>
                )}
              </div>
            </div>
            <div className="mt-6 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmUser(null)}
                disabled={busy?.field === 'delete'}
                className="text-[13px] font-medium px-4 py-2 rounded-full border transition-colors disabled:opacity-50"
                style={{ borderColor: T.borderLight, background: T.bgWhite, color: T.textBody }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                disabled={busy?.field === 'delete'}
                className="inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 rounded-full transition-colors disabled:opacity-60"
                style={{ background: T.danger, color: '#FFFFFF' }}
              >
                {busy?.field === 'delete' ? 'Deleting…' : (<><Trash2 className="w-3.5 h-3.5" /> Delete user</>)}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
