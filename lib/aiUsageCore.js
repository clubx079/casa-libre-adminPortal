// AI usage log — the pure parts (no fetch, no DB): reading the token counts out of an AI
// answer (Anthropic JSON or stream, Groq JSON), the row we save in `ai_usage_log`, and the
// sums the AI usage page shows. lib/aiUsage.js does the logging. test/aiUsage.test.js.
import { costUsd, priceFor } from './aiPricing.js';

export const APPS = ['admin', 'website'];
export const PROVIDERS = ['anthropic', 'groq'];

const n = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.round(Number(v))) : 0);

// Anthropic's usage object (messages.create / finalMessage / a stream's message_start + message_delta)
export function anthropicUsage(u = {}) {
  return {
    input: n(u?.input_tokens),
    output: n(u?.output_tokens),
    cacheRead: n(u?.cache_read_input_tokens),
    cacheWrite: n(u?.cache_creation_input_tokens),
  };
}

// Groq (OpenAI-compatible): usage.prompt_tokens / completion_tokens; cached prompt tokens when
// Groq reports them (prompt_tokens_details.cached_tokens) are part of prompt_tokens.
export function groqUsage(u = {}) {
  const cached = n(u?.prompt_tokens_details?.cached_tokens);
  return { input: Math.max(0, n(u?.prompt_tokens) - cached), output: n(u?.completion_tokens), cacheRead: cached, cacheWrite: 0 };
}

// A finished response body (text) → { model, usage } or null. JSON for a normal call; for a
// streamed Anthropic call (server-sent events) the model + input counts come in message_start
// and the final output count in the last message_delta.
export function usageFromBody(provider, text) {
  const body = String(text || '');
  if (!body.trim()) return null;
  if (provider === 'anthropic' && /^\s*(event|data):/m.test(body) && !body.trim().startsWith('{')) {
    let model = null; let usage = {};
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith('data:')) continue;
      let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (ev?.type === 'message_start') { model = ev.message?.model || model; usage = { ...usage, ...(ev.message?.usage || {}) }; }
      if (ev?.type === 'message_delta' && ev.usage) usage = { ...usage, ...Object.fromEntries(Object.entries(ev.usage).filter(([, v]) => v != null)) };
    }
    return model || Object.keys(usage).length ? { model, usage: anthropicUsage(usage) } : null;
  }
  let j; try { j = JSON.parse(body); } catch { return null; }
  if (provider === 'groq') return j?.usage ? { model: j.model || null, usage: groqUsage(j.usage) } : null;
  return j?.usage ? { model: j.model || null, usage: anthropicUsage(j.usage) } : null;
}

// The model the request asked for (when the answer doesn't say, e.g. an error)
export function requestModel(body) {
  try { return JSON.parse(typeof body === 'string' ? body : '')?.model || null; } catch { return null; }
}

// → the ai_usage_log row
export function usageRow({ app = 'admin', provider, model, feature, usage = {}, ok = true, ref = null, at = null }) {
  const u = { input: n(usage.input), output: n(usage.output), cacheRead: n(usage.cacheRead), cacheWrite: n(usage.cacheWrite) };
  return {
    ...(at ? { created_at: at } : {}),
    app: APPS.includes(app) ? app : 'admin',
    provider: PROVIDERS.includes(provider) ? provider : String(provider || 'unknown').slice(0, 20),
    model: String(model || 'unknown').slice(0, 80),
    feature: String(feature || 'other').slice(0, 60),
    input_tokens: u.input,
    output_tokens: u.output,
    cache_read_tokens: u.cacheRead,
    cache_write_tokens: u.cacheWrite,
    cost_usd: costUsd(model, u),
    ok: !!ok,
    ref: ref ? String(ref).slice(0, 120) : null,
  };
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────
// rows: ai_usage_log rows of the last 30 days (any order). tz offset in minutes (the country's
// local day; Paraguay = -180). → everything the AI usage page shows.
const DAY = 86400000;
const cost = (r) => Number(r.cost_usd) || 0;
const add = (acc, r) => {
  acc.calls += 1;
  acc.failed += r.ok === false ? 1 : 0;
  acc.input += n(r.input_tokens); acc.output += n(r.output_tokens);
  acc.cacheRead += n(r.cache_read_tokens); acc.cacheWrite += n(r.cache_write_tokens);
  acc.cost += cost(r);
  return acc;
};
const empty = () => ({ calls: 0, failed: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
const round = (t) => ({ ...t, cost: Math.round(t.cost * 1e6) / 1e6 });
export const localDay = (iso, tzMin = 0) => new Date(Date.parse(iso) + tzMin * 60000).toISOString().slice(0, 10);

export function summarize(rows = [], { now = Date.now(), tzMin = 0, days = 30, top = 20 } = {}) {
  const today = localDay(new Date(now).toISOString(), tzMin);
  const startOf = (k) => Date.parse(`${localDay(new Date(now - (k - 1) * DAY).toISOString(), tzMin)}T00:00:00Z`) - tzMin * 60000;
  const since7 = startOf(7); const since30 = startOf(days);
  const periods = { today: empty(), d7: empty(), d30: empty() };
  const byDay = new Map();
  for (let i = days - 1; i >= 0; i--) byDay.set(localDay(new Date(now - i * DAY).toISOString(), tzMin), { ...empty(), byProvider: { anthropic: 0, groq: 0 } });
  const byFeature = new Map(); const byModel = new Map();
  const inRange = rows.filter((r) => Date.parse(r.created_at) >= since30 && Date.parse(r.created_at) <= now + 60000);
  for (const r of inRange) {
    const t = Date.parse(r.created_at);
    const day = localDay(r.created_at, tzMin);
    add(periods.d30, r);
    if (t >= since7) add(periods.d7, r);
    if (day === today) add(periods.today, r);
    const d = byDay.get(day);
    if (d) { add(d, r); d.byProvider[r.provider === 'groq' ? 'groq' : 'anthropic'] += cost(r); }
    const fk = `${r.app || 'admin'}|${r.feature || 'other'}`;
    if (!byFeature.has(fk)) byFeature.set(fk, { app: r.app || 'admin', feature: r.feature || 'other', providers: new Set(), ...empty() });
    const f = byFeature.get(fk); add(f, r); f.providers.add(r.provider);
    const mk = `${r.provider}|${r.model}`;
    if (!byModel.has(mk)) byModel.set(mk, { provider: r.provider, model: r.model, priced: !!priceFor(r.model), ...empty() });
    add(byModel.get(mk), r);
  }
  const sortCost = (a, b) => b.cost - a.cost || b.calls - a.calls;
  return {
    totals: { today: round(periods.today), d7: round(periods.d7), d30: round(periods.d30) },
    daily: [...byDay].map(([key, v]) => ({ key, ...round(v), byProvider: v.byProvider })),
    byFeature: [...byFeature.values()].map((f) => ({ ...round(f), providers: [...f.providers] })).sort(sortCost),
    byModel: [...byModel.values()].map(round).sort(sortCost),
    top: [...inRange].sort((a, b) => cost(b) - cost(a) || Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, top)
      .map((r) => ({ id: r.id ?? null, created_at: r.created_at, app: r.app, provider: r.provider, model: r.model, feature: r.feature, input: n(r.input_tokens), output: n(r.output_tokens), cacheRead: n(r.cache_read_tokens), cacheWrite: n(r.cache_write_tokens), cost: cost(r), ok: r.ok !== false, ref: r.ref || null })),
  };
}

// What each feature is, for the page (feature key → label). Unknown keys show as they are.
export const FEATURE_LABEL = {
  inbox_auto_reply: 'Inbox AI · answers to questions',
  inbox_sale_reply: 'Inbox AI · sales reply to thanks / reactions',
  inbox_window_followup: 'Inbox AI · window follow-up',
  inbox_ai_draft: 'Inbox · "Reply with AI" drafts',
  wa_classify: 'WhatsApp message sorting',
  issue_translate: 'Open issues translation',
  manager_agent: 'Admin Manager · agent',
  manager_brief: 'Admin Manager · brief',
  manager_compose: 'Admin Manager · email drafts',
  translate: 'Translation (Inbox / templates)',
  translate_preview: 'Translation · "Preview in English"',
  property_type_classify: 'Scrapers · property type',
  listing_photo_check: 'Website · listing photo check',
  listing_translate: 'Website · listing "Translate" button',
};
