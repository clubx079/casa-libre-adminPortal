// Admin-facing control + status for the sharded InfoCasas scraper. The scheduled
// backfill/incremental runs via /api/cron/infocasas (CRON_SECRET); this route is
// session-authed for the admin dashboard: GET returns shard/ingest progress, POST
// runs ONE bounded shard slice on demand (a manual/test tick).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { selectWithCount, select } from '@/lib/db';
import { getSourceByKey, getActiveRun, startRun, runJob } from '@/lib/scrape';
import { nextDueShard, advanceShard } from '@/lib/shards';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const SRC_KEY = 'infocasas';

async function shardStats(sourceId) {
  const [total, backfill, incremental] = await Promise.all([
    selectWithCount('scrape_shards', `select=id&source_id=eq.${sourceId}&limit=1`).then((r) => r.count).catch(() => null),
    selectWithCount('scrape_shards', `select=id&source_id=eq.${sourceId}&phase=eq.backfill&limit=1`).then((r) => r.count).catch(() => null),
    selectWithCount('scrape_shards', `select=id&source_id=eq.${sourceId}&phase=eq.incremental&limit=1`).then((r) => r.count).catch(() => null),
  ]);
  return { total, backfillPending: backfill, incremental };
}

// GET /api/infocasas -> { source, shards, properties, quarantined, activeRun, recentRuns }
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const source = await getSourceByKey(SRC_KEY);
    const [shards, properties, quarantined, active, recentRuns] = await Promise.all([
      shardStats(source.id),
      selectWithCount('properties', `select=id&source_id=eq.${source.id}&is_delisted=eq.false&limit=1`).then((r) => r.count).catch(() => null),
      selectWithCount('ingest_quarantine', `select=id&source_id=eq.${source.id}&status=eq.pending&limit=1`).then((r) => r.count).catch(() => null),
      getActiveRun(source.id),
      select('scrape_runs', `source_id=eq.${source.id}&select=id,status,total_found,inserted_count,updated_count,skipped_count,images_uploaded,started_at,finished_at&order=started_at.desc&limit=5`).catch(() => []),
    ]);
    return NextResponse.json({
      source: { key: source.key, name: source.name, is_active: source.is_active },
      shards, properties, quarantined,
      activeRun: active ? { id: active.id, status: active.status } : null,
      recentRuns,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// POST /api/infocasas { limit }  -> run ONE bounded shard slice on demand.
// Awaits the run (bounded by `limit`, clamped 1..25) and returns its summary.
export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  let bodyLimit = 5;
  try {
    const b = await req.json();
    if (b && Number.isFinite(Number(b.limit))) bodyLimit = Math.max(1, Math.min(25, Math.floor(Number(b.limit))));
  } catch { /* default */ }

  try {
    const source = await getSourceByKey(SRC_KEY);
    if (!source.is_active) return NextResponse.json({ error: 'source_inactive' }, { status: 409 });
    if (await getActiveRun(source.id)) return NextResponse.json({ error: 'run_in_progress' }, { status: 409 });

    const shard = await nextDueShard(source.id);
    if (!shard) return NextResponse.json({ ok: true, done: 'no_due_shards' });

    const isIncremental = shard.phase === 'incremental';
    const filters = {
      params: shard.params,
      skip: isIncremental ? 0 : shard.cursor,
      order: 3, // newest-first for both phases (order:0 is price-desc → garbage-first)
      limit: bodyLimit,
      class: 'all',
      ...(isIncremental ? { stopWhenKnown: true } : {}),
    };
    const { runId } = await startRun({ sourceKey: SRC_KEY, filters, trigger: 'manual' });
    const summary = await runJob({ runId });
    const reachedEnd = summary.found < bodyLimit;
    await advanceShard(shard, { found: summary.found, inserted: summary.inserted, updated: summary.updated, reachedEnd });
    return NextResponse.json({ ok: true, shard: shard.shard_key, phase: shard.phase, ...summary, reachedEnd });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
