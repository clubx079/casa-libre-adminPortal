// Shard scheduler helpers — mocked lib/db (the real lib/db.js starts with
// `import 'server-only'`, which throws outside Next/under vitest, so it must
// never load here).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../lib/db', () => ({
  select: vi.fn(),
  update: vi.fn(),
}));

import { select, update } from '../lib/db';
import { nextDueShard, advanceShard } from '../lib/shards.js';

describe('nextDueShard', () => {
  beforeEach(() => {
    select.mockReset();
    update.mockReset();
  });

  it('returns the top backfill shard, querying phase=backfill ordered by priority then last_run_at nulls-first', async () => {
    const row = { id: 's1', phase: 'backfill', cursor: 0, priority: 10 };
    select.mockResolvedValueOnce([row]);

    const result = await nextDueShard('src-1');

    expect(result).toEqual(row);
    expect(select).toHaveBeenCalledTimes(1); // no fallback query needed
    const [table, query] = select.mock.calls[0];
    expect(table).toBe('scrape_shards');
    expect(query).toContain('source_id=eq.src-1');
    expect(query).toContain('enabled=eq.true');
    expect(query).toContain('phase=eq.backfill');
    expect(query).toContain('priority.asc');
    expect(query).toContain('last_run_at.asc.nullsfirst');
    expect(query).toContain('limit=1');
  });

  it('falls back to the oldest-last_run_at (nulls first) incremental shard once no backfill shards remain', async () => {
    select.mockResolvedValueOnce([]); // backfill query: none due
    const incRow = { id: 's2', phase: 'incremental', last_run_at: null };
    select.mockResolvedValueOnce([incRow]);

    const result = await nextDueShard('src-1');

    expect(result).toEqual(incRow);
    expect(select).toHaveBeenCalledTimes(2);
    const [table1, query1] = select.mock.calls[0];
    expect(table1).toBe('scrape_shards');
    expect(query1).toContain('phase=eq.backfill');
    const [table2, query2] = select.mock.calls[1];
    expect(table2).toBe('scrape_shards');
    expect(query2).toContain('source_id=eq.src-1');
    expect(query2).toContain('enabled=eq.true');
    expect(query2).toContain('phase=eq.incremental');
    expect(query2).toContain('last_run_at.asc.nullsfirst');
    expect(query2).toContain('limit=1');
  });

  it('returns null when no shards are due in either phase', async () => {
    select.mockResolvedValueOnce([]);
    select.mockResolvedValueOnce([]);

    const result = await nextDueShard('src-1');

    expect(result).toBeNull();
  });
});

describe('advanceShard', () => {
  beforeEach(() => {
    select.mockReset();
    update.mockReset();
    update.mockResolvedValue([{}]);
  });

  it('reachedEnd on a backfill shard flips phase -> incremental and zeroes cursor', async () => {
    const shard = { id: 'sh1', phase: 'backfill', cursor: 120 };

    await advanceShard(shard, { found: 30, inserted: 5, updated: 2, reachedEnd: true });

    expect(update).toHaveBeenCalledTimes(1);
    const [table, filter, patch] = update.mock.calls[0];
    expect(table).toBe('scrape_shards');
    expect(filter).toBe('id=eq.sh1');
    expect(patch.cursor).toBe(0);
    expect(patch.phase).toBe('incremental');
    expect(patch.backfilled_at).toBeTruthy();
    expect(patch.last_new).toBe(7); // inserted + updated
    expect(patch.last_run_at).toBeTruthy();
    expect(patch.last_status).toBeTruthy();
  });

  it('mid-backfill advance (not reachedEnd) bumps cursor by found and leaves phase untouched', async () => {
    const shard = { id: 'sh2', phase: 'backfill', cursor: 100 };

    await advanceShard(shard, { found: 50, inserted: 3, updated: 1, reachedEnd: false });

    const [, , patch] = update.mock.calls[0];
    expect(patch.cursor).toBe(150); // 100 + 50
    expect(patch.phase).toBeUndefined();
    expect(patch.backfilled_at).toBeUndefined();
    expect(patch.last_new).toBe(4); // inserted + updated
  });

  it('reachedEnd on an already-incremental shard does not touch phase/backfilled_at', async () => {
    const shard = { id: 'sh3', phase: 'incremental', cursor: 0 };

    await advanceShard(shard, { found: 10, inserted: 1, updated: 0, reachedEnd: true });

    const [, , patch] = update.mock.calls[0];
    expect(patch.phase).toBeUndefined();
    expect(patch.cursor).toBe(0);
    expect(patch.backfilled_at).toBeUndefined();
    expect(patch.last_new).toBe(1);
  });

  it('defaults missing found/inserted/updated to 0', async () => {
    const shard = { id: 'sh4', phase: 'incremental', cursor: 5 };

    await advanceShard(shard, { reachedEnd: false });

    const [, , patch] = update.mock.calls[0];
    expect(patch.cursor).toBe(5); // + 0
    expect(patch.last_new).toBe(0);
  });
});
