import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('swr (stale-while-revalidate cache)', () => {
  let swr; let forget;
  beforeEach(async () => {
    delete globalThis.__clSwrCache;
    vi.resetModules();
    vi.useFakeTimers({ toFake: ['Date'] });
    ({ swr, forget } = await import('../lib/swrCache.js'));
  });
  afterEach(() => vi.useRealTimers());
  const opts = { fresh: 1000, stale: 10_000 };
  const flush = () => new Promise((r) => setImmediate(r));

  it('loads once, then serves the copy while it is fresh', async () => {
    const loader = vi.fn(async () => 'v1');
    expect(await swr('k', loader, opts)).toBe('v1');
    expect(await swr('k', loader, opts)).toBe('v1');
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('requests made at the same time share one load', async () => {
    const loader = vi.fn(async () => 'v1');
    const [a, b] = await Promise.all([swr('k', loader, opts), swr('k', loader, opts)]);
    expect([a, b]).toEqual(['v1', 'v1']);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('when stale: answers at once with the old copy and refreshes it behind', async () => {
    let n = 0;
    const loader = vi.fn(async (prev) => `v${++n}${prev ? `<${prev}` : ''}`);
    await swr('k', loader, opts);
    vi.advanceTimersByTime(2000);
    expect(await swr('k', loader, opts)).toBe('v1'); // no wait
    await flush();
    expect(loader).toHaveBeenCalledTimes(2);
    expect(await swr('k', loader, opts)).toBe('v2<v1'); // the loader got the previous value
  });

  it('when too old: waits for a new copy', async () => {
    let n = 0;
    const loader = vi.fn(async () => `v${++n}`);
    await swr('k', loader, opts);
    vi.advanceTimersByTime(20_000);
    expect(await swr('k', loader, opts)).toBe('v2');
  });

  it('a failed background refresh keeps the old copy; a failed first load throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await swr('k', async () => 'v1', opts);
    vi.advanceTimersByTime(2000);
    expect(await swr('k', async () => { throw new Error('down'); }, opts)).toBe('v1');
    await flush();
    expect(await swr('k', async () => 'v2', { ...opts, fresh: 0 })).toBe('v1'); // still served, refresh started
    await expect(swr('other', async () => { throw new Error('down'); }, opts)).rejects.toThrow('down');
    err.mockRestore();
  });

  it('forget(prefix) drops matching keys', async () => {
    const loader = vi.fn(async () => 'v');
    await swr('held:py', loader, opts);
    forget('held:');
    await swr('held:py', loader, opts);
    expect(loader).toHaveBeenCalledTimes(2);
  });
});
