// Shard scheduler for the InfoCasas rotator (Task 8): picks the next shard
// due for a scrape tick, and records the outcome of a tick back onto the
// shard row. Server-only via `lib/db`'s own `import 'server-only'` guard.
import { select, update } from './db';

const nowIso = () => new Date().toISOString();

// Among enabled shards for a source: backfill phase goes first (lowest
// `priority`, then oldest/null `last_run_at`); once no backfill shards
// remain, the incremental shard with the oldest (or never-run) `last_run_at`
// is due. Returns the shard row, or null if nothing is due.
export async function nextDueShard(sourceId) {
  const base = `source_id=eq.${sourceId}&enabled=eq.true`;
  // IMPORTANT: PostgREST's `.nullsfirst` ordering is NOT honored on this AiroBase
  // deployment (never-run rows sort LAST, not first) — relying on it left the
  // rotator stuck on the single already-run shard forever. So select never-run
  // shards EXPLICITLY (last_run_at=is.null) first, then fall back to the
  // oldest-run shard. This yields correct round-robin over all shards.
  for (const phase of ['backfill', 'incremental']) {
    const [fresh] = await select(
      'scrape_shards',
      `${base}&phase=eq.${phase}&last_run_at=is.null&order=priority.asc&limit=1`
    );
    if (fresh) return fresh;
    const [oldest] = await select(
      'scrape_shards',
      `${base}&phase=eq.${phase}&order=priority.asc,last_run_at.asc&limit=1`
    );
    if (oldest) return oldest;
  }
  return null;
}

// Records the result of one cron tick against a shard. `found` is items
// fetched in this tick's slice; `inserted`/`updated` are new/changed
// properties (recorded as `last_new`). `reachedEnd` means the tick fetched
// fewer than it asked for — the slice is exhausted, so the cursor resets to
// 0; a backfill shard that reaches its end graduates to `incremental`.
export async function advanceShard(shard, { found = 0, inserted = 0, updated = 0, reachedEnd = false } = {}) {
  const patch = {
    last_run_at: nowIso(),
    last_status: reachedEnd ? 'success' : 'partial',
    last_new: (inserted || 0) + (updated || 0),
  };

  if (reachedEnd) {
    patch.cursor = 0;
    if (shard.phase === 'backfill') {
      patch.phase = 'incremental';
      patch.backfilled_at = nowIso();
    }
  } else {
    patch.cursor = (shard.cursor || 0) + (found || 0);
  }

  const [row] = await update('scrape_shards', `id=eq.${shard.id}`, patch, { returning: 'representation' });
  return row || { ...shard, ...patch };
}
