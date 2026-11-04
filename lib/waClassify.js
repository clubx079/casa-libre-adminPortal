// Sorting incoming WhatsApp messages BY AI (Claude) — robot / thanks / emoji / greeting /
// question / text … (lib/waClassifyCore.js). Used by the Inbox assistant (lib/inboxAuto.js),
// the campaign results (lib/waCampaignStore.js: "Replied" = real people only) and Open issues.
//   1. what WhatsApp itself says (a button tap, a reaction, a file) is taken as is
//   2. a message sorted before is read from the cache (the `automations` row 'wa_msg_kinds' of
//      that country DB, newest 4,000) — every message is sorted once
//   3. the rest: one Claude call per 40 messages (structured output)
//   4. Claude unreachable (no key, no credit, down) → the old wording rules (lib/waInboundKind.js)
//      as a BACKUP only; not cached, so the AI sorts them on the next try.
// items: [{ id, text, type, media, secondsAfterOurs, ourLast }] → Map(id → { kind, real, by })
// Server only.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { inboundKind } from './waInboundKind.js';
import { structuralKind, sureKind, isReal, CLASSIFY_SYSTEM, CLASSIFY_SCHEMA, classifyAsk, parseClassified, mergeCache } from './waClassifyCore.js';

export const CACHE_ID = 'wa_msg_kinds';
export const CLASSIFY_MODEL = process.env.INBOX_CLASSIFY_MODEL || 'claude-opus-5-5';
const BATCH = 40;

async function readCache(db) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${CACHE_ID}&limit=1`).catch(() => []);
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return s.kinds && typeof s.kinds === 'object' ? s.kinds : {};
}
async function writeCache(db, fresh) {
  if (!fresh.size) return;
  const kinds = mergeCache(await readCache(db), fresh);
  const [row] = await db.select('automations', `select=id&id=eq.${CACHE_ID}&limit=1`).catch(() => []);
  const p = { enabled: false, free_tiers: [{ kinds }], updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${CACHE_ID}`, p, { returning: 'minimal' }).catch(() => {});
  else await db.insert('automations', [{ id: CACHE_ID, wait_days: 0, ...p }], { returning: 'minimal' }).catch(() => {});
}

async function askClaude(items) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 45000, maxRetries: 1 });
  const msg = await client.messages.create({
    model: CLASSIFY_MODEL,
    max_tokens: 4000,
    system: CLASSIFY_SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: CLASSIFY_SCHEMA } },
    messages: [{ role: 'user', content: classifyAsk(items) }],
  });
  const text = (msg.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
  return parseClassified(JSON.parse(text), items.map((x) => String(x.id)));
}

export async function classifyInbound(db, items = []) {
  const out = new Map();
  const todo = [];
  for (const it of items) {
    const id = String(it.id || '');
    if (!id || out.has(id)) continue;
    const s = structuralKind(it);
    if (s) { out.set(id, { kind: s, real: isReal(s), by: 'whatsapp' }); continue; }
    const sure = sureKind(it.text);   // "gracias", "¿por qué un número de EEUU?" — no AI call needed
    if (sure) out.set(id, { kind: sure, real: isReal(sure), by: 'rules' });
    else todo.push({ ...it, id });
  }
  if (!todo.length) return out;
  const cache = await readCache(db);
  const ask = [];
  for (const it of todo) {
    const c = cache[it.id];
    if (c) out.set(it.id, { kind: c[0], real: isReal(c[0]), by: 'ai' });
    else ask.push(it);
  }
  const fresh = new Map();
  if (ask.length && process.env.ANTHROPIC_API_KEY) {
    for (let i = 0; i < ask.length; i += BATCH) {
      const part = ask.slice(i, i + BATCH);
      const got = await askClaude(part).catch((e) => { console.error('[waClassify]', String(e?.message || e).slice(0, 160)); return null; });
      if (got) for (const [id, v] of got) fresh.set(id, v);
    }
  }
  for (const it of ask) {
    const v = fresh.get(it.id);
    if (v) out.set(it.id, { kind: v.kind, real: isReal(v.kind), by: 'ai', reason: v.reason });
    else { const k = inboundKind(it, { secondsAfterOurs: it.secondsAfterOurs ?? null }); out.set(it.id, { kind: k.kind, real: k.real, by: 'rules' }); }
  }
  await writeCache(db, fresh);
  return out;
}

// For a thread: every inbound message with how long after our last message it came and what
// we had said — the items classifyInbound needs. messages in any order.
const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0) || 0;
export function inboundItems(messages = [], { limit = 6 } = {}) {
  const sorted = [...messages].sort((a, b) => t(a) - t(b));
  const items = [];
  let lastOut = null;
  for (const m of sorted) {
    if (m?.direction === 'outbound') { lastOut = m; continue; }
    if (m?.direction !== 'inbound') continue;
    items.push({ id: m.id, text: m.text, type: m.type, media: m.media, secondsAfterOurs: lastOut ? Math.round((t(m) - t(lastOut)) / 1000) : null, ourLast: lastOut?.text || (lastOut?.template?.name ? `(template ${lastOut.template.name})` : null) });
  }
  return items.slice(-limit);
}
