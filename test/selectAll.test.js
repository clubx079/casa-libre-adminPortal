import { describe, it, expect, vi, beforeEach } from 'vitest';

// fake table of n rows; select / selectWithCount read limit+offset from the query
function fakeDb(n) {
  const rows = () => Array.from({ length: n.value }, (_, i) => ({ id: i }));
  const slice = (q) => { const p = new URLSearchParams(q); const off = +p.get('offset'); return rows().slice(off, off + +p.get('limit')); };
  return {
    select: vi.fn(async (_t, q) => slice(q)),
    selectWithCount: vi.fn(async (_t, q) => ({ rows: slice(q), count: n.value })),
  };
}

describe('selectAll', () => {
  let selectAll;
  beforeEach(async () => { delete globalThis.__clSelectAllCounts; vi.resetModules(); ({ selectAll } = await import('../lib/selectAll.js')); });

  it('first read: counts, then reads the other pages at the same time', async () => {
    const db = fakeDb({ value: 2500 });
    const rows = await selectAll(db, 'properties', 'select=id');
    expect(rows.length).toBe(2500);
    expect(db.selectWithCount).toHaveBeenCalledTimes(1);
    expect(db.select).toHaveBeenCalledTimes(2);
  });

  it('next read: all pages start at once from the remembered size, and still finds rows that were added', async () => {
    const n = { value: 2500 };
    const db = fakeDb(n);
    await selectAll(db, 'properties', 'select=id');
    db.selectWithCount.mockClear(); db.select.mockClear();
    n.value = 3200; // grew past the 3 pages remembered
    const rows = await selectAll(db, 'properties', 'select=id');
    expect(db.selectWithCount).not.toHaveBeenCalled();
    expect(rows.length).toBe(3200);
    expect(new Set(rows.map((r) => r.id)).size).toBe(3200);
  });

  it('works when the table shrank', async () => {
    const n = { value: 2500 };
    const db = fakeDb(n);
    await selectAll(db, 'properties', 'select=id');
    n.value = 900;
    expect((await selectAll(db, 'properties', 'select=id')).length).toBe(900);
  });
});
