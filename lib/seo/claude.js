// Stage 4 — guide drafts written by Claude from our real numbers. The official SDK through the admin's
// logged client (lib/aiTrack.js → ai_usage_log). Model: SEO_DRAFT_MODEL (default claude-opus-5-5).
// Any failure (no key, no credit, bad JSON) throws — the caller falls back to the data template
// (lib/seo/draftTemplate.js), so a draft always exists. Server-only.
import 'server-only';
import { claudeClient } from '../aiTrack.js';

export const DRAFT_MODEL = process.env.SEO_DRAFT_MODEL || 'claude-opus-5-5';

const SYSTEM = `You write short, useful Spanish (rioplatense/Paraguayan "vos") answer pages for Casa Libre, a property marketplace (houses, apartments, land for sale and rent; contact by WhatsApp; app for iPhone and Android).
Rules:
- Answer the question in the first paragraph, plainly. No hype, no superlatives, no invented facts, no legal/tax figures you were not given.
- Every number about listings MUST be written as the placeholder token you are given (e.g. {{median:/alquiler/departamentos/asuncion}}), never as a literal number: the website fills them with live data every month.
- Never name other websites, portals, apps, agencies or competitors (no InfoCasas, Clasipar, RE/MAX, Century 21, Facebook Marketplace, Mercado Libre or any other), and never write a link or web address of another site. Only Casa Libre.
- Return ONLY JSON: {"title": str (<=70 chars), "h1": str, "description": str (<=160 chars), "answer": str, "sections": [{"h2": str, "paras": [str]}] (3-5 sections), "faq": [{"q": str, "a": str}] (3-5)}`;

export async function draftWithClaude(ctx, template, { country } = {}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
  const client = await claudeClient({ feature: 'seo_draft', country }, { timeout: 120000, maxRetries: 0 });
  const p = template.answerPath;
  const tokens = p ? ['count', 'median', 'min', 'max', 'newest'].map((k) => `{{${k}:${p}}}`).concat('{{month}}') : ['{{month}}'];
  const user = [
    `Search to answer: "${ctx.term}" (${ctx.kind === 'trend_post' ? 'a topic trending in ' + ctx.countryName + ' now' : 'people search this in ' + ctx.countryName}).`,
    ctx.stats ? `Live data for ${p}: ${JSON.stringify(ctx.stats)} (US$).` : 'No listing data for this question.',
    ctx.news?.length ? `News headlines: ${ctx.news.map((n) => n.title).join(' | ')}` : '',
    `Placeholder tokens you may use for numbers: ${tokens.join(' ')}`,
    `A plain draft to improve on (keep its facts and tokens): ${JSON.stringify({ title: template.title, h1: template.h1, answer: template.answer, sections: template.sections, faq: template.faq })}`,
  ].filter(Boolean).join('\n\n');
  const msg = await client.messages.create({ model: DRAFT_MODEL, max_tokens: 4000, system: SYSTEM, messages: [{ role: 'user', content: user }] });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) throw new Error('Claude returned no JSON');
  const j = JSON.parse(m[0]);
  if (!j.title || !j.h1 || !Array.isArray(j.sections) || !j.sections.length) throw new Error('Claude JSON is missing fields');
  return {
    ...template,
    title: String(j.title).slice(0, 90), h1: String(j.h1).slice(0, 140), description: String(j.description || template.description).slice(0, 200),
    answer: String(j.answer || template.answer),
    sections: j.sections.map((s) => ({ h2: String(s.h2 || ''), paras: (s.paras || []).map(String) })).filter((s) => s.h2 && s.paras.length),
    faq: (j.faq || []).map((f) => ({ q: String(f.q || ''), a: String(f.a || '') })).filter((f) => f.q && f.a),
    model: msg.model || DRAFT_MODEL,
  };
}
