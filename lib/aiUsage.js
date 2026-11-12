// Every AI call the admin makes is logged in that country's `ai_usage_log` (tokens in / out,
// cache, US$ cost from lib/aiPricing.js) — the AI usage page adds them up.
//   anthropicClient({ feature, country | db, ref, ...sdkOptions })  an Anthropic client whose
//       every request (create, stream, retries) is logged — use it instead of `new Anthropic()`
//   groqFetch({ feature, country | db, ref })  a fetch for Groq's chat completions that logs
//   logAiUsage({ provider, model, feature, usage, ok, ref, country | db })  log one call yourself
// Fire-and-forget, like lib/api-usage.js: the response goes back to the caller untouched and at
// once; the token counts are read from a COPY of it in the background. Logging never throws,
// never waits, and stops trying for 10 minutes when the table doesn't exist yet (migration
// migrations/010_ai_usage_log.sql not run). Server only.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { dbFor } from './db';
import { activeCountry, DEFAULT_COUNTRY } from './adminCountry';
import { usageFromBody, usageRow, requestModel } from './aiUsageCore.js';

export const TABLE = 'ai_usage_log';
const MISSING_FOR_MS = 10 * 60 * 1000;
const missing = (globalThis.__clAiUsageMissing ||= new Map());   // db client → until when we don't try
export const isMissingTable = (e) => ['42P01', 'PGRST205', 'PGRST204'].includes(e?.code) || /does not exist|schema cache|Could not find the table/i.test(String(e?.message || ''));

// the country this call is for: the one passed, else the admin's country switcher (inside a
// request), else the default
function dbOf(meta = {}) {
  if (meta.db && typeof meta.db.insert === 'function') return meta.db;
  let cc = meta.country;
  if (!cc) { try { cc = activeCountry(); } catch { cc = DEFAULT_COUNTRY; } }
  return dbFor(cc || DEFAULT_COUNTRY);
}

export function logAiUsage({ app = 'admin', provider, model, feature, usage, ok = true, ref = null, ...where }) {
  let db;
  try { db = dbOf(where); } catch { return; }
  const until = missing.get(db);
  if (until && until > Date.now()) return;
  let row;
  try { row = usageRow({ app, provider, model, feature, usage, ok, ref }); } catch { return; }
  Promise.resolve().then(() => db.insert(TABLE, [row], { returning: 'minimal' })).catch((e) => {
    if (isMissingTable(e)) missing.set(db, Date.now() + MISSING_FOR_MS);
  });
}

// A fetch that logs the AI call it makes. meta = { provider, feature, ref, country | db }.
export function trackedFetch(meta = {}, baseFetch = globalThis.fetch) {
  // pin the country now (still inside the request when the client is made)
  let db = null;
  try { db = dbOf(meta); } catch { /* logging only */ }
  const where = db ? { db } : {};
  return async (input, init) => {
    const asked = requestModel(init?.body);
    let res;
    try {
      res = await baseFetch(input, init);
    } catch (e) {
      logAiUsage({ ...meta, ...where, model: asked, usage: {}, ok: false });
      throw e;
    }
    try {
      const copy = res.clone();
      copy.text().then((text) => {
        const got = res.ok ? usageFromBody(meta.provider, text) : null;
        logAiUsage({ ...meta, ...where, model: got?.model || asked, usage: got?.usage || {}, ok: res.ok && !!got });
      }).catch(() => {});
    } catch { /* never in the way */ }
    return res;
  };
}

export function anthropicClient({ feature, country, db, ref = null, ...opts } = {}) {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, ...opts, fetch: trackedFetch({ provider: 'anthropic', feature, ref, country, db }) });
}

export const groqFetch = ({ feature, country, db, ref = null } = {}) => trackedFetch({ provider: 'groq', feature, ref, country, db });

// For the page: is the table there? → { ok: true } | { ok: false, missing: true } | { ok: false, error }
export async function usageRows(db, sinceIso) {
  try {
    const rows = [];
    for (let page = 0; page < 20; page++) {
      const part = await db.select(TABLE, `select=id,created_at,app,provider,model,feature,input_tokens,output_tokens,cache_read_tokens,cache_write_tokens,cost_usd,ok,ref&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=5000&offset=${page * 5000}`);
      rows.push(...part);
      if (part.length < 5000) break;
    }
    return { ok: true, rows };
  } catch (e) {
    return isMissingTable(e) ? { ok: false, missing: true, rows: [] } : { ok: false, error: String(e?.message || e).slice(0, 200), rows: [] };
  }
}
