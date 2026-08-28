'use client';
// Admin control panel for the SHARDED InfoCasas scraper. Unlike the generic
// ScrapeDetail (single source, filter form), InfoCasas is split into ~104 shards
// driven by the rotating /api/cron/infocasas schedule. This panel shows backfill
// progress and lets an admin run one bounded chunk on demand (a manual tick).
import { useState, useEffect, useCallback } from 'react';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  borderLight: '#E7E1D6',
  bgSurface: '#FAF7F1',
  bgWhite: '#FFFFFF',
  accent: '#111111',
  success: '#0F6E56',
  successSurface: '#E4F1E9',
  danger: '#B23A3A',
  dangerSurface: '#F6E4E1',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };
const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-US'));
const fmtDate = (v) => { try { return new Date(v).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };

function Stat({ label, value, sub }) {
  return (
    <div className="p-4" style={{ ...CARD, background: T.bgWhite }}>
      <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-2xl font-bold mt-1" style={{ color: T.textPrimary }}>{value}</div>
      {sub ? <div className="text-[11px] mt-0.5" style={{ color: T.textSecondary }}>{sub}</div> : null}
    </div>
  );
}

export default function InfocasasPanel({ source }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState(null);
  const [runErr, setRunErr] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/infocasas', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (e) { setError(e.message || 'load failed'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function runChunk() {
    setRunning(true); setRunErr(''); setRunResult(null);
    try {
      const res = await fetch('/api/infocasas', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limit: 5 }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setRunResult(json);
      load();
    } catch (e) { setRunErr(e.message || 'run failed'); }
    finally { setRunning(false); }
  }

  if (loading) return <div className="text-sm" style={{ color: T.textSecondary }}>Loading InfoCasas status…</div>;
  if (error) return <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.dangerSurface, color: T.danger }}>{error}</div>;

  const s = data.shards || {};
  const total = s.total || 0;
  const pending = s.backfillPending || 0;
  const done = Math.max(0, total - pending);
  const pct = total ? Math.round((done / total) * 100) : 0;

  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>{source.name}</h1>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={data.source?.is_active ? { background: T.textPrimary, color: '#fff' } : { background: T.bgSurface, color: T.textSecondary }}>
            {data.source?.is_active ? 'ACTIVE' : 'PAUSED'}
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: T.bgSurface, color: T.textSecondary }}>SHARDED</span>
        </div>
        <p className="text-[13px] mt-1 max-w-2xl" style={{ color: T.textSecondary }}>{source.description}</p>
      </div>

      {/* Backfill progress */}
      <div className="p-5" style={{ ...CARD, background: T.bgWhite }}>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-bold" style={{ color: T.textPrimary }}>Backfill progress</span>
          <span className="text-[13px] font-semibold tabular-nums" style={{ color: T.textBody }}>{done} / {total} chunks ({pct}%)</span>
        </div>
        <div className="w-full h-2.5 rounded-full overflow-hidden" style={{ background: T.bgSurface }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: T.accent }} />
        </div>
        <div className="text-[11px] mt-2" style={{ color: T.textMuted }}>
          {pending} chunk{pending === 1 ? '' : 's'} still in first-pass backfill · {fmt(s.incremental)} now in incremental refresh
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Live listings" value={fmt(data.properties)} sub="active, not delisted" />
        <Stat label="In quarantine" value={fmt(data.quarantined)} sub="held for review" />
        <Stat label="Total chunks" value={fmt(total)} sub="department × operation" />
      </div>

      {/* Manual run */}
      <div className="p-5" style={{ ...CARD, background: T.bgSurface }}>
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="text-sm font-bold" style={{ color: T.textPrimary }}>Run one chunk now</div>
            <p className="text-[12px] mt-1 max-w-md" style={{ color: T.textSecondary }}>
              Runs the next due shard for up to 5 listings through the full pipeline (a manual test tick).
              Regular scraping is driven automatically by the InfoCasas cron schedule — this button is for verification.
              It can take up to a few minutes.
            </p>
          </div>
          <button
            onClick={runChunk}
            disabled={running || data.activeRun}
            className="shrink-0 text-[13px] font-semibold px-4 py-2 rounded-full transition-colors disabled:opacity-50"
            style={{ background: T.accent, color: '#fff' }}
          >
            {running ? 'Running…' : data.activeRun ? 'Run in progress' : 'Run one chunk'}
          </button>
        </div>
        {runErr ? <div className="text-xs mt-3 px-3 py-2 rounded-[10px]" style={{ background: T.dangerSurface, color: T.danger }}>{runErr}</div> : null}
        {runResult ? (
          <div className="text-xs mt-3 px-3 py-2 rounded-[10px] tabular-nums" style={{ background: T.successSurface, color: T.success }}>
            {runResult.done === 'no_due_shards'
              ? 'No due shards — all backfilled and freshly refreshed.'
              : `Shard ${runResult.shard} (${runResult.phase}): found ${runResult.found}, inserted ${runResult.inserted}, updated ${runResult.updated}, quarantined ${runResult.quarantined}, images ${runResult.images}.`}
          </div>
        ) : null}
      </div>

      {/* Recent runs */}
      {Array.isArray(data.recentRuns) && data.recentRuns.length ? (
        <div className="p-5" style={{ ...CARD, background: T.bgWhite }}>
          <div className="text-sm font-bold mb-3" style={{ color: T.textPrimary }}>Recent runs</div>
          <div className="space-y-1.5">
            {data.recentRuns.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-[12px] tabular-nums" style={{ color: T.textBody }}>
                <span style={{ color: T.textSecondary }}>{fmtDate(r.started_at)}</span>
                <span className="font-semibold" style={{ color: r.status === 'success' ? T.success : r.status === 'failed' ? T.danger : T.textBody }}>{r.status}</span>
                <span>found {fmt(r.total_found)} · +{fmt(r.inserted_count)} · imgs {fmt(r.images_uploaded)}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
