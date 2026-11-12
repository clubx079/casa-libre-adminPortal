import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PRICES, priceFor, costUsd } from '../lib/aiPricing.js';
import { anthropicUsage, groqUsage, usageFromBody, usageRow, summarize, requestModel } from '../lib/aiUsageCore.js';

describe('prices', () => {
  it('has a price for every model the code uses', () => {
    for (const m of ['claude-opus-5-5', 'openai/gpt-oss-20b', 'qwen/qwen3.8-27b']) expect(priceFor(m), m).toBeTruthy();
  });
  it('Opus 5.5: $4 in / $20 out / $0.20 cache read / $5 cache write per million', () => {
    expect(PRICES['claude-opus-5-5']).toMatchObject({ input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 });
    expect(costUsd('claude-opus-5-5', { input: 1e6 })).toBe(4);
    expect(costUsd('claude-opus-5-5', { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 100 })).toBeCloseTo(0.004 + 0.01 + 0.0004 + 0.0005, 6);
  });
  it('Groq gpt-oss-20b and qwen vision', () => {
    expect(costUsd('openai/gpt-oss-20b', { input: 1e6, output: 1e6 })).toBeCloseTo(0.375, 6);
    expect(costUsd('qwen/qwen3.8-27b', { input: 2000, output: 40 })).toBeCloseTo(0.00176, 6);
  });
  it('suffixed ids use the base price; unknown models cost 0', () => {
    expect(priceFor('claude-opus-5-5-20261101')).toBe(PRICES['claude-opus-5-5']);
    expect(costUsd('some-new-model', { input: 1e6 })).toBe(0);
  });
});

describe('reading token counts', () => {
  it('Anthropic usage', () => {
    expect(anthropicUsage({ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 7, cache_creation_input_tokens: 3 })).toEqual({ input: 10, output: 5, cacheRead: 7, cacheWrite: 3 });
  });
  it('Groq usage (cached tokens are inside prompt_tokens)', () => {
    expect(groqUsage({ prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 40 } })).toEqual({ input: 60, output: 20, cacheRead: 40, cacheWrite: 0 });
  });
  it('a JSON body', () => {
    expect(usageFromBody('anthropic', JSON.stringify({ model: 'claude-opus-5-5', usage: { input_tokens: 9, output_tokens: 4 } }))).toEqual({ model: 'claude-opus-5-5', usage: { input: 9, output: 4, cacheRead: 0, cacheWrite: 0 } });
    expect(usageFromBody('groq', JSON.stringify({ model: 'openai/gpt-oss-20b', usage: { prompt_tokens: 50, completion_tokens: 8 } })).usage).toEqual({ input: 50, output: 8, cacheRead: 0, cacheWrite: 0 });
  });
  it('a streamed Anthropic answer: message_start + the last message_delta', () => {
    const sse = [
      'event: message_start', `data: ${JSON.stringify({ type: 'message_start', message: { model: 'claude-opus-5-5', usage: { input_tokens: 1200, cache_read_input_tokens: 300, cache_creation_input_tokens: 50, output_tokens: 1 } } })}`, '',
      'event: content_block_delta', `data: ${JSON.stringify({ type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } })}`, '',
      'event: message_delta', `data: ${JSON.stringify({ type: 'message_delta', usage: { output_tokens: 777 } })}`, '',
      'event: message_stop', 'data: {"type":"message_stop"}', '',
    ].join('\n');
    expect(usageFromBody('anthropic', sse)).toEqual({ model: 'claude-opus-5-5', usage: { input: 1200, output: 777, cacheRead: 300, cacheWrite: 50 } });
  });
  it('garbage → null; request model read from the body', () => {
    expect(usageFromBody('anthropic', 'not json')).toBeNull();
    expect(usageFromBody('groq', '')).toBeNull();
    expect(requestModel(JSON.stringify({ model: 'x' }))).toBe('x');
    expect(requestModel(undefined)).toBeNull();
  });
  it('the row', () => {
    const r = usageRow({ provider: 'anthropic', model: 'claude-opus-5-5', feature: 'wa_classify', usage: { input: 1000, output: 100 }, ref: 'msg_1' });
    expect(r).toMatchObject({ app: 'admin', provider: 'anthropic', model: 'claude-opus-5-5', feature: 'wa_classify', input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, ok: true, ref: 'msg_1' });
    expect(r.cost_usd).toBeCloseTo(0.006, 6);
  });
});

describe('summarize (the page)', () => {
  const now = Date.parse('2026-11-13T15:00:00Z');   // 12:00 in Paraguay
  const row = (h, extra) => ({ created_at: new Date(now - h * 3600000).toISOString(), app: 'admin', provider: 'anthropic', model: 'claude-opus-5-5', feature: 'inbox_auto_reply', input_tokens: 1000, output_tokens: 100, cache_read_tokens: 0, cache_write_tokens: 0, cost_usd: 0.006, ok: true, ...extra });
  const rows = [
    row(1), row(2, { provider: 'groq', model: 'openai/gpt-oss-20b', feature: 'translate', cost_usd: 0.0001 }),
    row(14, { feature: 'wa_classify', cost_usd: 0.002 }),            // yesterday in Paraguay (01:00 UTC = 22:00 PY)
    row(24 * 5, { feature: 'inbox_window_followup', cost_usd: 0.03 }),
    row(24 * 20, { app: 'website', provider: 'groq', model: 'qwen/qwen3.8-27b', feature: 'listing_photo_check', cost_usd: 0.002, ok: false }),
    row(24 * 40, { cost_usd: 99 }),                                  // older than 30 days: out
  ];
  const s = summarize(rows, { now, tzMin: -180 });
  it('today / 7 days / 30 days in the country\'s days', () => {
    expect(s.totals.today.calls).toBe(2);
    expect(s.totals.d7.calls).toBe(4);
    expect(s.totals.d30.calls).toBe(5);
    expect(s.totals.d30.cost).toBeCloseTo(0.006 + 0.0001 + 0.002 + 0.03 + 0.002, 6);
    expect(s.totals.d30.failed).toBe(1);
  });
  it('30 daily buckets with the provider split', () => {
    expect(s.daily).toHaveLength(30);
    const today = s.daily[s.daily.length - 1];
    expect(today.key).toBe('2026-11-13');
    expect(today.byProvider.anthropic).toBeCloseTo(0.006, 6);
    expect(today.byProvider.groq).toBeCloseTo(0.0001, 6);
  });
  it('by feature and model, most expensive first; top calls', () => {
    expect(s.byFeature[0].feature).toBe('inbox_window_followup');
    expect(s.byFeature.find((f) => f.feature === 'listing_photo_check').app).toBe('website');
    expect(s.byModel.map((m) => m.model)).toContain('qwen/qwen3.8-27b');
    expect(s.top[0].cost).toBe(0.03);
    expect(s.top).toHaveLength(5);
  });
});

const h = vi.hoisted(() => {
  const st = { inserts: [], failWith: null };
  st.db = { insert: async (table, rows) => { if (st.failWith) throw st.failWith; st.inserts.push({ table, rows }); }, select: async () => [] };
  return st;
});
vi.mock('server-only', () => ({}));
vi.mock('../lib/adminCountry', () => ({ activeCountry: () => 'py', DEFAULT_COUNTRY: 'py' }));
vi.mock('../lib/db', () => ({ dbFor: () => h.db }));

describe('logAiUsage / trackedFetch (fire-and-forget)', () => {
  const inserts = h.inserts;
  beforeEach(() => { inserts.length = 0; h.failWith = null; globalThis.__clAiUsageMissing?.clear(); });
  const flush = () => new Promise((r) => setTimeout(r, 20));

  it('logs a Groq call from a copy of the response; the caller gets the response untouched', async () => {
    const { trackedFetch } = await import('../lib/aiUsage.js');
    const body = JSON.stringify({ model: 'openai/gpt-oss-20b', usage: { prompt_tokens: 120, completion_tokens: 30 }, choices: [{ message: { content: 'Hello' } }] });
    const f = trackedFetch({ provider: 'groq', feature: 'translate', country: 'py' }, async () => new Response(body, { status: 200 }));
    const res = await f('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'openai/gpt-oss-20b' }) });
    expect((await res.json()).choices[0].message.content).toBe('Hello');
    await flush();
    expect(inserts).toHaveLength(1);
    expect(inserts[0].table).toBe('ai_usage_log');
    expect(inserts[0].rows[0]).toMatchObject({ provider: 'groq', model: 'openai/gpt-oss-20b', feature: 'translate', input_tokens: 120, output_tokens: 30, ok: true });
  });
  it('a failed call is logged as failed with the asked model; a network error still reaches the caller', async () => {
    const { trackedFetch } = await import('../lib/aiUsage.js');
    const f = trackedFetch({ provider: 'anthropic', feature: 'wa_classify' }, async () => new Response('{"error":{}}', { status: 529 }));
    expect((await f('u', { body: JSON.stringify({ model: 'claude-opus-5-5' }) })).status).toBe(529);
    const g = trackedFetch({ provider: 'anthropic', feature: 'wa_classify' }, async () => { throw new Error('offline'); });
    await expect(g('u', { body: '{}' })).rejects.toThrow('offline');
    await flush();
    expect(inserts.map((x) => x.rows[0].ok)).toEqual([false, false]);
    expect(inserts.map((x) => x.rows[0].model)).toContain('claude-opus-5-5');
  });
  it('a missing table never breaks the call, and logging pauses instead of retrying every call', async () => {
    const { trackedFetch, logAiUsage } = await import('../lib/aiUsage.js');
    h.failWith = Object.assign(new Error('relation "public.ai_usage_log" does not exist'), { code: '42P01' });
    const f = trackedFetch({ provider: 'groq', feature: 'translate' }, async () => new Response(JSON.stringify({ model: 'm', usage: { prompt_tokens: 1, completion_tokens: 1 } })));
    expect((await f('u', {})).ok).toBe(true);
    await flush();
    h.failWith = null;
    logAiUsage({ provider: 'groq', model: 'm', feature: 'translate', usage: {} });
    await flush();
    expect(inserts).toHaveLength(0);   // paused for 10 minutes
  });
});
