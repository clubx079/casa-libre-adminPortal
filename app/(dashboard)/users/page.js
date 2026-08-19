'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Search, X, Users as UsersIcon, Activity, CheckCircle2, Circle } from 'lucide-react';

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
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

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

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(false);
    (async () => {
      try {
        const res = await fetch(`/api/users${term ? `?q=${encodeURIComponent(term)}` : ''}`);
        const json = await res.json();
        if (!cancelled) {
          if (res.ok) { setUsers(json.users || []); setCount(json.count || 0); }
          else setError(true);
        }
      } catch {
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [term]);

  const submit = (e) => { e.preventDefault(); setTerm(q.trim()); };

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
          <table className="w-full min-w-[860px]">
            <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['User', 'Phone', 'Method', 'Status', 'Joined', 'Last login', ''].map((h, i) => (
                  <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i >= 6 ? 'text-right' : 'text-left'}`} style={{ color: T.textSecondary }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(6)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(7)].map((__, j) => (
                      <td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 0 ? '160px' : '70px', background: T.bgSurface }} /></td>
                    ))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan="7" className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load users. Check the DB connection.</td></tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center">
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
                      <span className="text-[11px] px-2 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>
                        {u.auth_provider === 'google' ? 'Google' : 'Email'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {u.active === false ? (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}><Circle className="w-3 h-3" /> Inactive</span>
                      ) : u.verified ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full" style={{ background: T.successSurface, color: T.success }}><CheckCircle2 className="w-3 h-3" /> Verified</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}><Circle className="w-3 h-3" /> Unverified</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{fmtDate(u.created_at)}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textMuted }}>{fmtWhen(u.last_login_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/analytics?user=${encodeURIComponent(u.id)}&email=${encodeURIComponent(u.email || '')}`}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-full border transition-colors"
                        style={{ borderColor: T.borderLight, color: T.textBody }}>
                        <Activity className="w-3.5 h-3.5" /> Activity
                      </Link>
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
