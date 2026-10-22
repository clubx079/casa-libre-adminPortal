// COPY of the website's lib/translate.js (buyer portal): the same Groq translation as the
// listing "Translate" button. Here it powers the admin's "Preview in English" on Reports and
// Feedback (POST /api/translate-preview). Only change: translateText takes an optional
// `system` prompt (these are user messages, not listing descriptions).
// Originally: "Translate" button on a listing description (website property page + the app,
// both via POST /api/translate). Groq, like the admin portal's AI type classifier:
// GROQ_API_KEY + GROQ_MODEL (default openai/gpt-oss-20b). The route caches each
// translation in memory (one Groq call per description + language per server) and
// rate-limits uncached requests per IP, so it can't be used as a free translator.
import { createHash } from 'node:crypto';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const TARGETS = { es: 'Spanish (as written in Paraguay)', en: 'English' };
export const MAX_CHARS = 5000;

// Listing text as people read it: no html, normal spacing, line breaks kept.
export function cleanDescription(s) {
  return String(s || '')
    .replace(/\r\n?/g, '\n')            // Windows line ends make the model merge the lines
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_CHARS);
}

const systemPrompt = (target) => `You translate real-estate listing descriptions into ${TARGETS[target]}.
Rules: translate all of the text into ${TARGETS[target]}. Keep numbers, prices, currencies (₲, Gs., US$), measurements (m², m2), phone numbers, emails, links, and street, neighborhood and city names exactly as written. Keep the line breaks. Do not add, remove or summarize anything.
Reply with the translation only: no notes, no quotes, no heading.`;

// The translation, or null if Groq isn't configured / fails / cuts the answer short.
// Never throws.
export async function translateText(text, target, {
  apiKey = process.env.GROQ_API_KEY,
  model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b',
  fetchImpl = fetch,
  system = null,
} = {}) {
  if (!apiKey || !TARGETS[target]) return null;
  const src = cleanDescription(text);
  if (!src) return null;
  // Reasoning models (gpt-oss/qwen) spend tokens thinking before they answer.
  const reasoning = /gpt-oss|qwen/i.test(model);
  const answer = Math.ceil(src.length / 2) + 200;
  const body = {
    model,
    messages: [
      { role: 'system', content: system || systemPrompt(target) },
      { role: 'user', content: src },
    ],
    temperature: 0,
    max_tokens: Math.min(8000, answer + (reasoning ? 1024 : 0)),
  };
  if (reasoning) body.reasoning_effort = 'low';
  try {
    const res = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const choice = data?.choices?.[0];
    if (!choice || choice.finish_reason === 'length') return null;
    const out = String(choice.message?.content || '').replace(/[ \t]+\n/g, '\n').trim();
    return out || null;
  } catch {
    return null;
  }
}

// Translations by (cleaned text, target). Oldest entry goes first when full.
export function createCache(max = 2000) {
  const m = new Map();
  const key = (text, target) => `${target}:${createHash('sha1').update(cleanDescription(text)).digest('hex')}`;
  return {
    get: (text, target) => m.get(key(text, target)) ?? null,
    set(text, target, value) {
      const k = key(text, target);
      m.delete(k);
      m.set(k, value);
      if (m.size > max) m.delete(m.keys().next().value);
    },
  };
}

// At most `max` requests per IP per window.
export function createLimiter({ max, windowMs }) {
  const hits = new Map();
  return {
    allow(ip, now = Date.now()) {
      const k = ip || 'unknown';
      const h = hits.get(k);
      if (!h || now >= h.reset) {
        if (hits.size > 10000) for (const [x, v] of hits) if (now >= v.reset) hits.delete(x);
        hits.set(k, { n: 1, reset: now + windowMs });
        return true;
      }
      if (h.n >= max) return false;
      h.n += 1;
      return true;
    },
  };
}
