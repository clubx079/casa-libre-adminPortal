import Link from 'next/link';
import { selectWithCount, select } from '@/lib/db';

export const dynamic = 'force-dynamic';

const T = {
  textPrimary: '#111111',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

async function getStats() {
  try {
    const [{ count: total }, verified, recent] = await Promise.all([
      selectWithCount('users', 'select=id&limit=1'),
      selectWithCount('users', 'select=id&verified=eq.true&limit=1'),
      select('users', 'select=id,email,full_name,created_at,auth_provider&order=created_at.desc&limit=6'),
    ]);
    return { total, verified: verified.count, recent, ok: true };
  } catch {
    return { total: 0, verified: 0, recent: [], ok: false };
  }
}

const fmtDate = (v) => {
  try { return new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};

export default async function OverviewPage() {
  const { total, verified, recent, ok } = await getStats();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Overview</h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>Casa Libre admin — users &amp; activity at a glance</p>
      </div>

      {!ok && (
        <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>
          Couldn&apos;t reach the database. Check <span className="font-mono">AIROBASE_URL</span> / <span className="font-mono">AIROBASE_SECRET_KEY</span>.
        </div>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[
          { label: 'Total users', value: total.toLocaleString() },
          { label: 'Verified users', value: verified.toLocaleString() },
          { label: 'Unverified', value: Math.max(0, total - verified).toLocaleString() },
        ].map(({ label, value }) => (
          <div key={label} className="bg-white p-5" style={CARD}>
            <p className="text-xs font-medium" style={{ color: T.textSecondary }}>{label}</p>
            <p className="text-4xl font-bold tracking-head mt-3" style={{ color: T.textPrimary }}>{value}</p>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Recent users */}
        <div className="bg-white" style={CARD}>
          <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: T.borderLight }}>
            <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Recent users</h2>
            <Link href="/users" className="text-[11px] font-medium" style={{ color: T.textSecondary }}>View all →</Link>
          </div>
          <div>
            {recent.length === 0 ? (
              <p className="px-5 py-8 text-center text-xs" style={{ color: T.textMuted }}>No users yet.</p>
            ) : recent.map((u, i) => (
              <div key={u.id} className="flex items-center gap-3 px-5 py-3" style={{ borderTop: i ? `1px solid ${T.borderLight}` : 'none' }}>
                <span className="w-8 h-8 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center text-[13px] font-bold">
                  {(u.full_name || u.email || '?').trim().charAt(0).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }}>{u.full_name || u.email}</p>
                  <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{u.email}</p>
                </div>
                <span className="text-[11px] shrink-0" style={{ color: T.textMuted }}>{fmtDate(u.created_at)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Quick links */}
        <div className="grid grid-cols-1 gap-4 content-start">
          <Link href="/users" className="bg-white p-5 block transition-shadow hover:shadow-hard-soft" style={CARD}>
            <p className="text-sm font-bold" style={{ color: T.textPrimary }}>All users →</p>
            <p className="text-xs mt-1" style={{ color: T.textSecondary }}>Everyone who signed in to the buyer portal, with verification status and last login.</p>
          </Link>
          <Link href="/analytics" className="bg-white p-5 block transition-shadow hover:shadow-hard-soft" style={CARD}>
            <p className="text-sm font-bold" style={{ color: T.textPrimary }}>Analytics →</p>
            <p className="text-xs mt-1" style={{ color: T.textSecondary }}>User behaviour, funnel, and per-user session timelines from PostHog.</p>
          </Link>
        </div>
      </div>
    </div>
  );
}
