import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const DAY = 86400000;
const iso = (daysAgo) => new Date(Date.now() - daysAgo * DAY).toISOString();
// 250 emails, one every ~0.5 day, newest first; PY and another brand's domain mixed in.
const ALL = Array.from({ length: 250 }, (_, i) => ({
  id: `e${i}`,
  from: i % 5 === 0 ? 'Other <hi@deelmap.com>' : 'Casa Libre <hola@casa-libre.com.py>',
  to: ['x@y.com'],
  subject: 'Bienvenido a Casa Libre',
  last_event: 'delivered',
  created_at: iso(i * 0.5),
}));

function fakeResend() {
  return vi.fn(async (url) => {
    const u = new URL(url);
    const after = u.searchParams.get('after');
    const start = after ? ALL.findIndex((e) => e.id === after) + 1 : 0;
    const data = ALL.slice(start, start + 100);
    return { ok: true, status: 200, json: async () => ({ data, has_more: start + 100 < ALL.length }) };
  });
}

describe('countryEmails', () => {
  // the cache lives on globalThis (shared across Next route bundles): start each test empty
  beforeEach(() => { delete globalThis.__clSwrCache; vi.resetModules(); vi.useFakeTimers({ toFake: ['setTimeout'] }); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete process.env.RESEND_READ_API_KEY; });

  it('returns null without a read key (nothing fetched)', async () => {
    const fetch = fakeResend(); vi.stubGlobal('fetch', fetch);
    const { countryEmails } = await import('../lib/resendEmails.js');
    expect(await countryEmails('py', 30)).toBe(null);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('pages until the window ends and keeps only the country domain', async () => {
    process.env.RESEND_READ_API_KEY = 're_test';
    const fetch = fakeResend(); vi.stubGlobal('fetch', fetch);
    const { countryEmails } = await import('../lib/resendEmails.js');
    const p = countryEmails('py', 30);
    await vi.runAllTimersAsync();
    const r = await p;
    expect(r.domain).toBe('casa-libre.com.py');
    expect(r.truncated).toBe(false);
    expect(r.rows.every((e) => e.from.includes('casa-libre.com.py'))).toBe(true);
    // 30 days = emails 0..60 (61 rows), minus every 5th (deelmap) = 48
    expect(r.rows.length).toBe(48);
    // the whole year is read once (3 pages here) so every window can share it
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('says "cut" only when the page cap stops inside the asked window', async () => {
    process.env.RESEND_READ_API_KEY = 're_test';
    // endless account: always more pages; 100 emails per page, one every 0.01 day
    const fetch = vi.fn(async (url) => {
      const after = new URL(url).searchParams.get('after');
      const start = after ? Number(after.slice(1)) + 1 : 0;
      const data = Array.from({ length: 100 }, (_, k) => ({ id: `e${start + k}`, from: 'hola@casa-libre.com.py', to: ['x@y.com'], subject: 'x', last_event: 'delivered', created_at: iso((start + k) * 0.01) }));
      return { ok: true, status: 200, json: async () => ({ data, has_more: true }) };
    });
    vi.stubGlobal('fetch', fetch);
    const { countryEmails } = await import('../lib/resendEmails.js');
    const p = countryEmails('py', 7);
    await vi.runAllTimersAsync();
    const week = await p;
    expect(fetch).toHaveBeenCalledTimes(60); // 6,000 emails ≈ 60 days back
    expect(week.truncated).toBe(false);
    const sixty = await countryEmails('py', 90);
    expect(sixty.truncated).toBe(true);
  });

  it('reuses one fetch for a narrower window and for requests made at the same time', async () => {
    process.env.RESEND_READ_API_KEY = 're_test';
    const fetch = fakeResend(); vi.stubGlobal('fetch', fetch);
    const { countryEmails } = await import('../lib/resendEmails.js');
    const wide = countryEmails('py', 100);
    const same = countryEmails('py', 100);
    await vi.runAllTimersAsync();
    const [a, b] = await Promise.all([wide, same]);
    expect(a.rows.length).toBe(b.rows.length);
    const calls = fetch.mock.calls.length;
    const narrow = await countryEmails('py', 7);
    expect(fetch.mock.calls.length).toBe(calls);
    expect(narrow.rows.every((e) => Date.parse(e.created_at) >= Date.now() - 7 * DAY - 1000)).toBe(true);
    expect(narrow.rows.length).toBeLessThan(a.rows.length);
  });

  it('one read serves every country (the list is the whole account)', async () => {
    process.env.RESEND_READ_API_KEY = 're_test';
    const fetch = fakeResend(); vi.stubGlobal('fetch', fetch);
    const { countryEmails } = await import('../lib/resendEmails.js');
    const p = countryEmails('py', 30);
    await vi.runAllTimersAsync();
    await p;
    const calls = fetch.mock.calls.length;
    const bo = await countryEmails('bo', 30);
    expect(fetch.mock.calls.length).toBe(calls);
    expect(bo.domain).not.toBe('casa-libre.com.py');
  });
});

describe('refreshEmails (top-up instead of a full read)', () => {
  const H = 3600e3;
  const mk = (id, msAgo, now, last_event = 'delivered') => ({ id, created_at: new Date(now - msAgo).toISOString(), last_event });

  it('first read is a full read', async () => {
    const { refreshEmails } = await import('../lib/resendEmails.js');
    const now = Date.now();
    const list = vi.fn(async () => ({ rows: [mk('a', H, now)], truncated: false }));
    const r = await refreshEmails('k', undefined, now, list);
    expect(r.fullAt).toBe(now);
    expect(list.mock.calls[0][1]).toBeLessThan(now - 300 * 86400000); // a year back
  });

  it('later reads only fetch new emails + the last 3 days (statuses), and keep the older ones', async () => {
    const { refreshEmails } = await import('../lib/resendEmails.js');
    const now = Date.now();
    const prev = { rows: [mk('n1', 1 * H, now), mk('d2', 2 * 24 * H, now), mk('d5', 5 * 24 * H, now), mk('d9', 9 * 24 * H, now)], truncated: false, fullAt: now - H };
    // Resend now: one new email, and d2 got opened since
    const list = vi.fn(async (_k, cutoff) => ({ rows: [mk('new', 0, now), mk('n1', 1 * H, now), mk('d2', 2 * 24 * H, now, 'opened')].filter((e) => Date.parse(e.created_at) >= cutoff), truncated: false }));
    const r = await refreshEmails('k', prev, now, list);
    const cutoff = list.mock.calls[0][1];
    expect(cutoff).toBe(Date.parse(prev.rows[0].created_at) - 3 * 24 * H);
    expect(r.rows.map((e) => e.id)).toEqual(['new', 'n1', 'd2', 'd5', 'd9']);
    expect(r.rows.find((e) => e.id === 'd2').last_event).toBe('opened');
    expect(r.fullAt).toBe(prev.fullAt); // still the last full read
  });

  it('after 6 hours the refresh is a full read again', async () => {
    const { refreshEmails } = await import('../lib/resendEmails.js');
    const now = Date.now();
    const prev = { rows: [mk('a', H, now)], truncated: false, fullAt: now - 7 * H };
    const list = vi.fn(async () => ({ rows: [], truncated: false }));
    const r = await refreshEmails('k', prev, now, list);
    expect(r.fullAt).toBe(now);
    expect(list.mock.calls[0][1]).toBeLessThan(now - 300 * 86400000);
  });
});
