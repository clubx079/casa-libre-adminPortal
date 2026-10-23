// Admin Manager — the Claude agent. One weekly run:
//   1. Claude reads the data pack and investigates with the read-only tools (lib/manager/tools.js)
//      until it has what it needs (capped by turns and by money);
//   2. one last call returns the report as JSON in REPORT_SCHEMA (structured output).
// Model: Claude Opus 5.5, adaptive thinking, high effort. The system prompt and tool list
// never change for a country, so they are cached across turns. Needs ANTHROPIC_API_KEY.
// Server-only.
import Anthropic from '@anthropic-ai/sdk';
import { TOOL_DEFS, runTool } from './tools.js';
import { systemPrompt, FIRST_MESSAGE, FINAL_MESSAGE, REPORT_SCHEMA } from './prompt.js';

export const MODEL = process.env.MANAGER_MODEL || 'claude-opus-5-5';
const MAX_TURNS = Math.max(3, Number(process.env.MANAGER_MAX_TURNS || 30));
const MAX_USD = Math.max(0.5, Number(process.env.MANAGER_MAX_USD || 6));
// Server-side fallback: if the model declines a request, the API re-runs it on another model.
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

// US$ per million tokens (Claude Opus 5.5). Cache writes (5-minute) cost 1.25× input.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

export function addUsage(total, u = {}) {
  total.input += u.input_tokens || 0;
  total.output += u.output_tokens || 0;
  total.cacheRead += u.cache_read_input_tokens || 0;
  total.cacheWrite += u.cache_creation_input_tokens || 0;
  total.calls += 1;
  return total;
}
export const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0 });
export function costUsd(t) {
  const usd = (t.input * PRICE.input + t.output * PRICE.output + t.cacheRead * PRICE.cacheRead + t.cacheWrite * PRICE.cacheWrite) / 1e6;
  return Math.round(usd * 10000) / 10000;
}

// The model's final JSON text → object (structured output guarantees the shape).
export function parseReport(message) {
  const text = (message?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new Error(`No report text (stop_reason: ${message?.stop_reason})`);
  return JSON.parse(text);
}

const short = (input) => {
  const j = JSON.stringify(input);
  return j.length > 220 ? `${j.slice(0, 220)}…` : j;
};

// pack: the data pack; deps: tool deps (lib/manager/tools.js runTool);
// onProgress({ turn, tools, usage, costUsd }) after every turn (for the page's live log).
// One agent, start to finish. Defaults = the whole weekly report; the research team
// (lib/manager/team.js) passes its own system prompt, schema, messages and a smaller budget.
export async function runAgent({
  country, pack, deps, onProgress = async () => {},
  system: systemText = null, schema = REPORT_SCHEMA, firstMessage = FIRST_MESSAGE, finalMessage = FINAL_MESSAGE,
  maxTurns = MAX_TURNS, maxUsd = MAX_USD, withTools = true,
}) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 15 * 60 * 1000, maxRetries: 3 });
  const tools = withTools ? TOOL_DEFS.map((t) => ({ ...t, strict: true })) : undefined;
  const system = [{ type: 'text', text: systemText || systemPrompt(country), cache_control: { type: 'ephemeral' } }];
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: `Data pack (JSON):\n${JSON.stringify(pack)}` },
      { type: 'text', text: firstMessage },
    ],
  }];
  const usage = emptyUsage();
  let fallback = true;

  const call = async (extra = {}) => {
    const params = {
      model: MODEL,
      max_tokens: 32000,
      system,
      ...(tools ? { tools } : {}),
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' },
      messages,
      ...extra,
    };
    try {
      const msg = fallback
        ? await client.beta.messages.stream({ ...params, ...FALLBACK }).finalMessage()
        : await client.messages.stream(params).finalMessage();
      addUsage(usage, msg.usage);
      return msg;
    } catch (e) {
      // An account without the fallback beta: run without it from now on.
      if (fallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message))) {
        fallback = false;
        return call(extra);
      }
      throw e;
    }
  };

  // ── 1. investigate ──
  let notes = '';
  let askedFinal = false;
  for (let turn = 1; ; turn++) {
    const msg = await call();
    if (msg.stop_reason === 'refusal') throw new Error(`The model declined (${msg.stop_details?.category || 'no category'})`);
    messages.push({ role: 'assistant', content: msg.content });
    if (msg.stop_reason === 'pause_turn') continue;
    const uses = msg.content.filter((b) => b.type === 'tool_use');
    if (msg.stop_reason !== 'tool_use' || !uses.length) {
      notes = msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
      break;
    }
    const results = await Promise.all(uses.map(async (u) => ({ type: 'tool_result', tool_use_id: u.id, content: await runTool(u.name, u.input, deps) })));
    const spent = costUsd(usage);
    await onProgress({ turn, tools: uses.map((u) => ({ name: u.name, input: short(u.input) })), usage: { ...usage }, costUsd: spent });
    // Over budget and still calling tools after being told to stop: go straight to the report.
    if (turn > maxTurns || spent >= maxUsd * 0.85) {
      messages.push({ role: 'user', content: [...results, { type: 'text', text: finalMessage }] });
      askedFinal = true;
      break;
    }
    const stop = turn >= maxTurns || spent >= maxUsd * 0.7;
    messages.push({
      role: 'user',
      content: stop
        ? [...results, { type: 'text', text: 'That is the end of the investigation budget. Do not call more tools: write your findings note now.' }]
        : results,
    });
  }

  // ── 2. the report, as JSON ──
  if (!askedFinal) messages.push({ role: 'user', content: finalMessage });
  // Tools are sent non-strict here: no tool runs in this call, and strict tools + the JSON
  // schema together can exceed the API's grammar limit ("compiled grammar is too large").
  const final = await call({
    ...(tools ? { tools: TOOL_DEFS, tool_choice: { type: 'none' } } : {}),
    output_config: { effort: 'high', format: { type: 'json_schema', schema } },
  });
  if (final.stop_reason === 'refusal') throw new Error(`The model declined the report (${final.stop_details?.category || 'no category'})`);
  if (final.stop_reason === 'max_tokens') throw new Error('The report was cut off (max_tokens)');
  const report = parseReport(final);
  return { report, notes, usage, costUsd: costUsd(usage), model: final.model || MODEL };
}
