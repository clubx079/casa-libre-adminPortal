import { NextResponse } from 'next/server';
import { getSourceByKey, getActiveRun, startRun, runJob } from '@/lib/scrape';
import { nextDueShard, advanceShard } from '@/lib/shards';

export const runtime = 'nodejs';
export const maxDuration = 300;

// Called by AiroBase Cron with `Authorization: Bearer {{secrets.CRON_SECRET}}`.
// Runs ONE bounded, resumable shard slice per invocation (backfill or
// incremental) for the `infocasas` source, then advances that shard's cursor.
async function handle(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  // Optional manual override: POST { "limit": N } bounds THIS tick (for a smoke
  // test or a one-off manual run). Clamped to the shard's normal ceiling below;
  // ignored when absent (the scheduled cron sends no body).
  let bodyLimit = null;
  try {
    const b = await req.json();
    if (b && Number.isFinite(Number(b.limit))) bodyLimit = Math.max(1, Math.floor(Number(b.limit)));
  } catch { /* no/invalid body — normal for the scheduled GET/POST */ }

  const source = await getSourceByKey('infocasas');
  if (!source.is_active) return NextResponse.json({ ok: true, skipped: 'source_inactive' });
  if (await getActiveRun(source.id)) {
    // a shard is still running — skip this tick
    return NextResponse.json({ ok: true, skipped: 'run_in_progress' });
  }

  const shard = await nextDueShard(source.id);
  if (!shard) return NextResponse.json({ ok: true, done: 'no_due_shards' });

  const isIncremental = shard.phase === 'incremental';
  // Backfill batch size is configurable (source.config.tick_limit) so each tick
  // fits the platform timeout — default 40, sized for the image-screen-skipped
  // InfoCasas throughput (~10-15s/listing). Incremental sweeps stay small.
  const baseLimit = isIncremental ? 60 : (Number(source.config?.tick_limit) || 40);
  const limit = bodyLimit != null ? Math.min(bodyLimit, baseLimit) : baseLimit;
  const filters = {
    params: shard.params,
    skip: isIncremental ? 0 : shard.cursor, // incremental always starts at newest
    // order:3 = newest-first (id-descending), verified deterministic + stable
    // across page boundaries (Task 9). Used for BOTH phases: order:0 turned out
    // to be price-descending, which front-loads backfill with the most-expensive
    // (mostly garbage, >$50M) listings; order:3 processes normal recent listings
    // first and still paginates the whole slice via the cursor.
    order: 3,
    limit,
    class: 'all',
    ...(isIncremental ? { stopWhenKnown: true } : {}),
  };
  const { runId } = await startRun({ sourceKey: 'infocasas', filters, trigger: 'cron' });
  const summary = await runJob({ runId });
  const reachedEnd = summary.found < limit; // fewer than asked ⇒ slice exhausted
  await advanceShard(shard, { found: summary.found, inserted: summary.inserted, updated: summary.updated, reachedEnd });

  return NextResponse.json({ ok: true, shard: shard.shard_key, phase: shard.phase, ...summary, reachedEnd });
}

export const POST = handle;
export const GET = handle;
