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

  it('returns a NEVER-RUN backfill shard from the explicit is.null query first (nullsfirst is unreliable)', async () => {
    const row = { id: 's1', phase: 'backfill', cursor: 0, priority: 10 };
    select.mockResolvedValueOnce([row]);

    const result = await nextDueShard('src-1');

    expect(result).toEqual(row);
    expect(select).toHaveBeenCalledTimes(1); // fresh query hit — no fallback needed
    const [table, query] = select.mock.calls[0];
    expect(table).toBe('scrape_shards');
    expect(query).toContain('source_id=eq.src-1');
    expect(query).toContain('enabled=eq.true');
    expect(query).toContain('phase=eq.backfill');
    expect(query).toContain('last_run_at=is.null'); // explicit never-run selection
    expect(query).toContain('priority.asc');
    expect(query).toContain('limit=1');
    expect(query).not.toContain('nullsfirst'); // must NOT rely on the broken modifier
  });

  it('falls back to the oldest-run backfill shard when no never-run backfill shard exists', async () => {
    select.mockResolvedValueOnce([]); // backfill is.null: none
    const oldest = { id: 's1b', phase: 'backfill', last_run_at: '2026-01-01T00:00:00Z' };
    select.mockResolvedValueOnce([oldest]); // backfill oldest

    const result = await nextDueShard('src-1');

    expect(result).toEqual(oldest);
    expect(select).toHaveBeenCalledTimes(2);
    const [, q1] = select.mock.calls[0];
    expect(q1).toContain('last_run_at=is.null');
    const [, q2] = select.mock.calls[1];
    expect(q2).toContain('phase=eq.backfill');
    expect(q2).toContain('priority.asc,last_run_at.asc');
    expect(q2).not.toContain('is.null');
    expect(q2).not.toContain('nullsfirst');
  });

  it('moves to incremental (never-run first) only once no backfill shards remain', async () => {
    select.mockResolvedValueOnce([]); // backfill is.null: none
    select.mockResolvedValueOnce([]); // backfill oldest: none
    const incRow = { id: 's2', phase: 'incremental', last_run_at: null };
    select.mockResolvedValueOnce([incRow]); // incremental is.null

    const result = await nextDueShard('src-1');

    expect(result).toEqual(incRow);
    expect(select).toHaveBeenCalledTimes(3);
    const [, q3] = select.mock.calls[2];
    expect(q3).toContain('phase=eq.incremental');
    expect(q3).toContain('last_run_at=is.null');
  });

  it('returns null when no shards are due in either phase', async () => {
    select.mockResolvedValue([]); // every query: none

    const result = await nextDueShard('src-1');

    expect(result).toBeNull();
    expect(select).toHaveBeenCalledTimes(4); // backfill is.null, backfill oldest, inc is.null, inc oldest
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
