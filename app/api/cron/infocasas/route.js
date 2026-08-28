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

  const source = await getSourceByKey('infocasas');
  if (await getActiveRun(source.id)) {
    // a shard is still running — skip this tick
    return NextResponse.json({ ok: true, skipped: 'run_in_progress' });
  }

  const shard = await nextDueShard(source.id);
  if (!shard) return NextResponse.json({ ok: true, done: 'no_due_shards' });

  const isIncremental = shard.phase === 'incremental';
  const filters = {
    params: shard.params,
    skip: isIncremental ? 0 : shard.cursor, // incremental always starts at newest
    // order:3 is the confirmed newest-first (id-descending) value (Task 9 live
    // probe); order:0 (used for backfill) is relevance, not recency — fine
    // for backfill since it sweeps the whole slice regardless of order.
    order: isIncremental ? 3 : 0,
    limit: isIncremental ? 60 : 250, // small incremental sweep; bounded backfill slice
    class: 'all',
    ...(isIncremental ? { stopWhenKnown: true } : {}),
  };
  const { runId } = await startRun({ sourceKey: 'infocasas', filters, trigger: 'cron' });
  const summary = await runJob({ runId });
  const reachedEnd = summary.found < filters.limit; // fewer than asked ⇒ slice exhausted
  await advanceShard(shard, { found: summary.found, inserted: summary.inserted, updated: summary.updated, reachedEnd });

  return NextResponse.json({ ok: true, shard: shard.shard_key, phase: shard.phase, ...summary, reachedEnd });
}

export const POST = handle;
export const GET = handle;
