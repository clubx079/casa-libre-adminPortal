import 'server-only';
// AI visibility — the daily cycle (every 24 h, started by the SEO cron; or by hand from Admin → SEO):
//   1. ask every question to every assistant that has an API key (web search on) → one row each
//   2. ask the Grok bot for Google AI answers (if the bot is connected; its report lands here too)
//   3. the gaps of the last 7 days go to the AI SEO pipeline at Decide (signalsFor)
// Answers live in the CONTROL DB, table ai_visibility_answers (migrations/control/004_ai_visibility.sql).
import { BOTS } from '../grokBots.js';
import { analyzeAnswer, keywordOf, countryOf, languageOf, questionStats, toSignals } from './core.js';
import { PROVIDERS, activeProviders } from './providers.js';

const G = (globalThis.__clAiVisibility ||= { running: null, missingUntil: 0 });
const DAY = 86400000;
const enc = encodeURIComponent;
const today = () => new Date().toISOString().slice(0, 10);

let _ctrl = null;
async function ctrl() {
  if (!process.env.CONTROL_DB_URL || !process.env.CONTROL_DB_KEY) throw new Error('Control DB not configured');
  if (!_ctrl) { const { makeClient } = await import('../db.js'); _ctrl = makeClient(process.env.CONTROL_DB_URL, process.env.CONTROL_DB_KEY); }
  return _ctrl;
}
const isMissing = (e) => ['42P01', 'PGRST205', 'PGRST204'].includes(e?.code) || /does not exist|schema cache|Could not find the table/i.test(String(e?.message || ''));

// The questions: the visibility bot's list (Admin → Bots), one per line.
export function questions() {
  const bot = BOTS.find((b) => b.key === 'visibility');
  return String(bot?.defaults?.questions || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

async function save(rows) {
  if (!rows.length) return 0;
  const db = await ctrl();
  for (let i = 0; i < rows.length; i += 200) {
    await db.insert('ai_visibility_answers', rows.slice(i, i + 200), { upsert: true, onConflict: 'source_ref', returning: 'minimal' });
  }
  return rows.length;
}

const row = (base, a) => ({
  ...base, keyword: keywordOf(base.question), language: languageOf(base.question), country: countryOf(base.question),
  mentioned: a.mentioned, position: a.position, competitors: a.competitors, sources: a.sources, quote: a.quote,
});

// The Grok bot's visibility reports (Admin → Bots) → rows. Also imports the runs from before this
// pipeline existed. Skips items with no answer (logins, blocks) but keeps them as errors.
export async function ingestBotRuns({ limit = 30 } = {}) {
  const db = await ctrl();
  const runs = await db.select('bot_runs', `select=id,items,reported_at,started_at&bot_key=eq.visibility&status=eq.done&order=started_at.desc&limit=${limit}`);
  const rows = [];
  for (const r of runs) {
    (r.items || []).forEach((it, n) => {
      const question = String(it.question || '').trim();
      if (!question) return;
      const answer = String(it.fullAnswer || it.answer || '').trim();
      const base = {
        run_date: String(r.reported_at || r.started_at || new Date().toISOString()).slice(0, 10),
        assistant: String(it.assistant || 'unknown').toLowerCase().replace(/\s+/g, '-').slice(0, 40), provider: 'grok_bot', question,
        answer: answer.slice(0, 20000) || null, source_ref: `bot:${r.id}:${n}`,
      };
      if (!answer || answer.length < 40) { rows.push({ ...base, keyword: keywordOf(question), country: countryOf(question), language: languageOf(question), error: 'no answer (login wall or blocked)' }); return; }
      const a = analyzeAnswer(answer, it.sourcesCited || it.sources || []);
      // the bot's own reading wins when it says we were named and the text check missed a spelling
      if (!a.mentioned && it.mentionsCasaLibre === true) { a.mentioned = true; a.quote = it.wordsAboutCasaLibre || null; }
      rows.push(row(base, a));
    });
  }
  return save(rows);
}

// Ask the Grok bot for what our API keys can't reach: Google AI answers.
async function askGrokBot(by) {
  try {
    const { startRun } = await import('../bots/store.js');
    const r = await startRun('visibility', { settings: { assistants: ['google-ai'] }, by });
    return r?.started ? { started: true, runId: r.runId } : { started: false, why: r?.error || "not started" };
  } catch (e) { return { started: false, why: String(e?.message || e).slice(0, 160) }; }
}

async function pool(items, n, fn) {
  let i = 0;
  const worker = async () => { while (i < items.length) { const k = i++; await fn(items[k]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
}

// One full cycle. Skips when today's cycle already ran (force = run again).
export async function runCycle({ force = false, by = 'daily cycle', concurrency = 3 } = {}) {
  if (G.running) return { skipped: 'a cycle is already running' };
  const db = await ctrl();
  const date = today();
  if (!force) {
    const [done] = await db.select('ai_visibility_answers', `select=id&provider=eq.api&run_date=eq.${date}&limit=1`).catch((e) => { if (isMissing(e)) throw e; return []; });
    if (done) return { skipped: `already ran today (${date})` };
  }
  G.running = (async () => {
    const started = Date.now();
    const providers = activeProviders();
    const qs = questions();
    const jobs = providers.flatMap((p) => qs.map((q) => ({ p, q })));
    const rows = []; const errors = [];
    await pool(jobs, concurrency, async ({ p, q }) => {
      const base = { run_date: date, assistant: p, provider: 'api', question: q, source_ref: `api:${date}:${p}:${q}`.slice(0, 400) };
      try {
        const res = await PROVIDERS[p].ask(q);
        rows.push(row({ ...base, answer: String(res.text || '').slice(0, 20000) }, analyzeAnswer(res.text, res.citations)));
      } catch (e) {
        const msg = String(e?.message || e).slice(0, 300);
        errors.push(`${p}: ${msg}`);
        rows.push({ ...base, keyword: keywordOf(q), country: countryOf(q), language: languageOf(q), error: msg });
      }
    });
    const saved = await save(rows);
    const bot = await askGrokBot(by);
    const imported = await ingestBotRuns({ limit: 10 }).catch(() => 0);
    return { date, providers, questions: qs.length, saved, errors: errors.slice(0, 10), mentioned: rows.filter((r) => r.mentioned).length, grokBot: bot, importedFromBot: imported, seconds: Math.round((Date.now() - started) / 1000) };
  })();
  try { return await G.running; } finally { G.running = null; }
}

// Is today's cycle due? (no API answers in the last 24 h)
export async function isDue() {
  try {
    const db = await ctrl();
    const [last] = await db.select('ai_visibility_answers', 'select=created_at&provider=eq.api&order=created_at.desc&limit=1');
    return !last || Date.now() - Date.parse(last.created_at) > DAY - 3600000;
  } catch { return false; }
}

// Answers of the last `days` days (all countries).
export async function recentAnswers(days = 7) {
  const db = await ctrl();
  const since = new Date(Date.now() - days * DAY).toISOString().slice(0, 10);
  const out = [];
  for (let off = 0; off < 20000; off += 1000) {
    const page = await db.select('ai_visibility_answers', `select=run_date,country,assistant,provider,question,keyword,mentioned,position,competitors,sources,quote,error&run_date=gte.${since}&order=id.asc&limit=1000&offset=${off}`);
    out.push(...page);
    if (page.length < 1000) break;
  }
  return out;
}

// For Decide: the gap questions of this country as pipeline signals. [] when the table isn't there.
export async function signalsFor(cc, { days = 7 } = {}) {
  try {
    const stats = questionStats(await recentAnswers(days));
    return toSignals(stats, cc, today());
  } catch { return []; }
}

// For the SEO page: per question, the last 7 days (+ which assistants are switched on).
export async function overview(days = 7) {
  const answers = await recentAnswers(days);
  const stats = questionStats(answers);
  const byAssistant = {};
  for (const a of answers) {
    if (a.error) continue;
    const s = byAssistant[a.assistant] || { answers: 0, ours: 0 };
    s.answers += 1; if (a.mentioned) s.ours += 1;
    byAssistant[a.assistant] = s;
  }
  const db = await ctrl();
  const [last] = await db.select('ai_visibility_answers', 'select=created_at,run_date&order=created_at.desc&limit=1').catch(() => []);
  return {
    days, lastAnswerAt: last?.created_at || null, answers: answers.filter((a) => !a.error).length, failed: answers.filter((a) => a.error).length,
    mentionRate: (() => { const ok = answers.filter((a) => !a.error); return ok.length ? Math.round((ok.filter((a) => a.mentioned).length / ok.length) * 100) : 0; })(),
    byAssistant, questions: stats.map((s) => ({ question: s.question, country: s.country, keyword: s.keyword, answers: s.answers, ourRate: s.ourRate, compRate: s.compRate, gap: s.gap, topCompetitors: s.topCompetitors, avgPosition: s.avgPosition })),
    running: !!G.running,
  };
}
