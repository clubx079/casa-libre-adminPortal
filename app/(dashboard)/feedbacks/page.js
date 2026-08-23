'use client';

import { useEffect, useMemo, useState } from 'react';
import { Star, MessageSquare, User } from 'lucide-react';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
  gold: '#B8860B',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const fmtDate = (v) => {
  if (!v) return '—';
  try { return new Date(v).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }); }
  catch { return '—'; }
};

const Stars = ({ n }) => (
  <span className="inline-flex items-center gap-0.5" title={`${n}/5`}>
    {[1, 2, 3, 4, 5].map((i) => (
      <Star key={i} className="w-3.5 h-3.5" style={{ color: T.gold }} fill={i <= n ? T.gold : 'none'} strokeWidth={1.5} />
    ))}
  </span>
);

export default function FeedbacksPage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [tab, setTab] = useState('all');

  async function fetchRows() {
    setLoading(true); setError(false);
    try {
      const res = await fetch('/api/feedbacks', { cache: 'no-store' });
      const json = await res.json();
      if (res.ok) setRows(json.rows || []);
      else setError(true);
    } catch { setError(true); }
    finally { setLoading(false); }
  }
  useEffect(() => { fetchRows(); }, []);

  const stats = useMemo(() => {
    const total = rows.length;
    const sum = rows.reduce((a, r) => a + (Number(r.rating) || 0), 0);
    const avg = total ? (sum / total).toFixed(1) : '—';
    return { total, avg };
  }, [rows]);

  const shown = tab === 'all' ? rows : rows.filter((r) => Number(r.rating) === Number(tab));

  const Stat = ({ label, value }) => (
    <div className="bg-white px-4 py-3" style={CARD}>
      <div className="text-[22px] font-bold tracking-head" style={{ color: T.textPrimary }}>{value}</div>
      <div className="text-[11px] font-mono uppercase tracking-wider mt-0.5" style={{ color: T.textMuted }}>{label}</div>
    </div>
  );

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>Feedback</h1>
        <p className="text-[13px] mt-0.5" style={{ color: T.textSecondary }}>What users think of Casa Libre — star ratings and comments from the buyer portal.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 max-w-[360px]">
        <Stat label="Responses" value={stats.total} />
        <Stat label="Average rating" value={stats.avg} />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {[['all', 'All'], ['5', '5★'], ['4', '4★'], ['3', '3★'], ['2', '2★'], ['1', '1★']].map(([k, label]) => {
          const on = tab === k;
          const n = k === 'all' ? rows.length : rows.filter((r) => Number(r.rating) === Number(k)).length;
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
          <table className="w-full min-w-[900px]">
            <thead className="sticky top-0 z-10" style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['User', 'Rating', 'Comment', 'Source', 'When'].map((h, i) => (
                  <th key={i} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left" style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                [...Array(5)].map((_, i) => (
                  <tr key={i} className="border-b animate-pulse" style={{ borderColor: T.borderLight }}>
                    {[...Array(5)].map((__, j) => (<td key={j} className="px-4 py-3"><div className="h-3 rounded" style={{ width: j === 2 ? '220px' : '80px', background: T.bgSurface }} /></td>))}
                  </tr>
                ))
              ) : error ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center text-sm" style={{ color: T.textMuted }}>Couldn&apos;t load feedback. Check the DB connection.</td></tr>
              ) : shown.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <MessageSquare className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No feedback yet</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>Ratings and comments from users will show up here.</p>
                  </td>
                </tr>
              ) : shown.map((r) => (
                <tr key={r.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                  <td className="px-4 py-3 text-xs max-w-[180px]">
                    {r.name || r.email ? (
                      <>
                        <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }} title={r.name || ''}>{r.name || '—'}</p>
                        <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.email || '—'}</p>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: T.textMuted }}><User className="w-3 h-3" /> Anonymous</span>
                    )}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap"><Stars n={Number(r.rating) || 0} /></td>
                  <td className="px-4 py-3 text-xs max-w-[360px]" style={{ color: T.textBody }}>
                    <p className="line-clamp-3" title={r.message || ''}>{r.message || '—'}</p>
                  </td>
                  <td className="px-4 py-3 text-xs capitalize" style={{ color: T.textMuted }}>{r.source || 'site'}</td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textMuted }}>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
