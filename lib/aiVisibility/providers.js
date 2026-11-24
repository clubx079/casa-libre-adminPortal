import 'server-only';
// AI visibility — ask one AI assistant one question, WITH web search on (that's how they answer real
// users: from live search results). Each assistant is used only when its key is in the env; the
// model can be changed by env. Every function → { text, citations: [urls] } or throws.
//   claude      ANTHROPIC_API_KEY (already set)   web search tool       AIV_CLAUDE_MODEL
//   chatgpt     OPENAI_API_KEY                    Responses + web_search AIV_OPENAI_MODEL
//   gemini      GEMINI_API_KEY                    Google Search grounding AIV_GEMINI_MODEL
//   perplexity  PERPLEXITY_API_KEY                sonar (searches always) AIV_PERPLEXITY_MODEL
//   grok        XAI_API_KEY                       live search            AIV_GROK_MODEL
import { claudeClient } from '../aiTrack.js';

const SYSTEM = 'Answer the way you would answer any user who asks this. Be specific: name the websites, apps or companies you would recommend.';
const timeout = (ms) => AbortSignal.timeout(ms);
const okJson = async (r, who) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${who} ${r.status}: ${j.error?.message || j.message || JSON.stringify(j).slice(0, 160)}`); return j; };

async function askClaude(q) {
  const client = await claudeClient({ feature: 'ai_visibility' }, { timeout: 120000, maxRetries: 1 });
  const msg = await client.messages.create({
    model: process.env.AIV_CLAUDE_MODEL || 'claude-sonnet-5-5',
    max_tokens: 1500,
    system: SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: 3 }],
    messages: [{ role: 'user', content: q }],
  });
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  const citations = [];
  for (const b of msg.content || []) {
    if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.forEach((r) => r.url && citations.push(r.url));
    for (const c of b.citations || []) if (c.url) citations.push(c.url);
  }
  return { text, citations };
}

async function askChatgpt(q) {
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST', signal: timeout(120000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.AIV_OPENAI_MODEL || 'gpt-5', tools: [{ type: 'web_search' }], instructions: SYSTEM, input: q }),
  });
  const j = await okJson(r, 'OpenAI');
  let text = j.output_text || '';
  const citations = [];
  for (const o of j.output || []) for (const c of o.content || []) {
    if (!j.output_text && c.text) text += c.text;
    for (const a of c.annotations || []) if (a.url) citations.push(a.url);
  }
  return { text, citations };
}

async function askGemini(q) {
  const model = process.env.AIV_GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`, {
    method: 'POST', signal: timeout(120000), headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ systemInstruction: { parts: [{ text: SYSTEM }] }, contents: [{ role: 'user', parts: [{ text: q }] }], tools: [{ google_search: {} }] }),
  });
  const j = await okJson(r, 'Gemini');
  const cand = j.candidates?.[0] || {};
  const text = (cand.content?.parts || []).map((p) => p.text || '').join('');
  const citations = (cand.groundingMetadata?.groundingChunks || []).map((c) => c.web?.uri).filter(Boolean);
  return { text, citations };
}

async function askPerplexity(q) {
  const r = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST', signal: timeout(120000),
    headers: { Authorization: `Bearer ${process.env.PERPLEXITY_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.AIV_PERPLEXITY_MODEL || 'sonar', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q }] }),
  });
  const j = await okJson(r, 'Perplexity');
  return { text: j.choices?.[0]?.message?.content || '', citations: j.citations || (j.search_results || []).map((s) => s.url).filter(Boolean) };
}

async function askGrok(q) {
  const r = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST', signal: timeout(120000),
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.AIV_GROK_MODEL || 'grok-4', messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q }], search_parameters: { mode: 'on', return_citations: true } }),
  });
  const j = await okJson(r, 'Grok');
  return { text: j.choices?.[0]?.message?.content || '', citations: j.citations || [] };
}

export const PROVIDERS = {
  claude: { name: 'Claude', env: 'ANTHROPIC_API_KEY', ask: askClaude },
  chatgpt: { name: 'ChatGPT', env: 'OPENAI_API_KEY', ask: askChatgpt },
  gemini: { name: 'Gemini', env: 'GEMINI_API_KEY', ask: askGemini },
  perplexity: { name: 'Perplexity', env: 'PERPLEXITY_API_KEY', ask: askPerplexity },
  grok: { name: 'Grok', env: 'XAI_API_KEY', ask: askGrok },
};
export const activeProviders = () => Object.entries(PROVIDERS).filter(([, p]) => !!process.env[p.env]).map(([k]) => k);
export const providerStatus = () => Object.entries(PROVIDERS).map(([key, p]) => ({ key, name: p.name, on: !!process.env[p.env], env: p.env }));
