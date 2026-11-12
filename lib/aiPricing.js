// What every AI model we call costs, in US$ per MILLION tokens — the one place to update when a
// price changes (lib/aiUsage.js prices every call it logs with it; the AI usage page shows it).
// The website has the same table (buyer portal lib/aiPricing.js): change both.
//   input        uncached input tokens
//   output       output tokens (Claude's thinking is billed as output and included in output_tokens)
//   cacheRead    input read from the prompt cache
//   cacheWrite   input written to the prompt cache (5-minute cache = 1.25 x input)
//   source       where the figure came from, shown on the page
// Pure — test/aiUsage.test.js.
export const PRICES = {
  // Anthropic first-party API rates (claude-api skill model table, cached 2026-11-03:
  // Opus 5.5 $4 / $20, cache reads $0.20; cache writes ~1.25x input).
  'claude-opus-5-5': { provider: 'anthropic', input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5, source: 'Anthropic price table (claude-api docs, 2026-11-03)' },
  'claude-opus-5': { provider: 'anthropic', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, source: 'Anthropic price table (claude-api docs, 2026-11-03)' },
  'claude-opus-4-8': { provider: 'anthropic', input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, source: 'Anthropic price table (claude-api docs, 2026-11-03)' },
  'claude-sonnet-5-5': { provider: 'anthropic', input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5, source: 'Anthropic price table (claude-api docs, 2026-11-03)' },
  'claude-haiku-5-5': { provider: 'anthropic', input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125, source: 'Anthropic price table (claude-api docs, 2026-11-03)' },
  // Groq (console.groq.com/docs/models, read 2026-11-13). Groq lists no cache price for these.
  'openai/gpt-oss-20b': { provider: 'groq', input: 0.075, output: 0.3, cacheRead: 0.075, cacheWrite: 0.075, source: 'Groq models page (2026-11-13)' },
  'qwen/qwen3.8-27b': { provider: 'groq', input: 0.8, output: 4, cacheRead: 0.8, cacheWrite: 0.8, source: 'Groq models page (2026-11-13)' },
};

// A model id we don't have a price for is still logged (tokens), with cost 0 and priced: false.
// Dated / suffixed ids ("claude-opus-5-5-20261101", "claude-opus-5-5-fast") use their base price.
export function priceFor(model) {
  const m = String(model || '').trim().toLowerCase();
  if (!m) return null;
  if (PRICES[m]) return PRICES[m];
  const base = Object.keys(PRICES).sort((a, b) => b.length - a.length).find((k) => m.startsWith(`${k}-`) || m.startsWith(`${k}@`));
  return base ? PRICES[base] : null;
}

// tokens → US$ (rounded to 1/1,000,000 of a dollar)
export function costUsd(model, { input = 0, output = 0, cacheRead = 0, cacheWrite = 0 } = {}) {
  const p = priceFor(model);
  if (!p) return 0;
  const usd = (input * p.input + output * p.output + cacheRead * p.cacheRead + cacheWrite * p.cacheWrite) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}
