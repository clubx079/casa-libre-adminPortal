// Bots: the job the admin sends to a Grok Bot routine's webhook, and the report it sends back.
// Pure — test/botsJob.test.js. Flow (lib/bots/store.js, app/api/bots/*, app/api/bot-report):
//   admin  → POST <webhook url>  Authorization: Bearer <routine key>   body = buildJob(...)
//   bot    → POST <reportTo>     Authorization: Bearer <one-time token> body = { runId, summary, items }
// The bot's routine ("Casa-Libre job") is told to do exactly `task`, follow `rules`, apply `settings`.
import { BOTS, COUNTRIES, botByKey, mergeBotSettings } from '../grokBots.js';

export const MAX_ITEMS = 500;
export const NO_ANSWER_MIN = { test: 30, run: 180 };   // a run with no report after this is "no answer"

const label = (opts, v) => (opts || []).find((o) => o.value === v)?.label || v;
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);
const list = (arr) => (arr || []).join(', ');
const cc = (arr) => list((arr || []).map((v) => label(COUNTRIES, v)));
const field = (bot, key) => bot.fields.find((f) => f.key === key);
const opt = (bot, key, values) => list((values || []).map((v) => label(field(bot, key)?.options, v)));

const GLOBAL_RULES = [
  'Read public pages only. Never send, post, comment, like, follow, buy, delete, sign in or submit forms.',
  'Never include passwords, keys or private data in the report.',
  'Give the source page URL for every item.',
  'If part of the task cannot be done, skip it and say why in the summary.',
];

// What the bot must do, in plain words, from its settings.
export function taskFor(bot, s) {
  switch (bot.key) {
    case 'lead-finder':
      return `Find real-estate ${opt(bot, 'leadTypes', s.leadTypes) || 'agents, agencies and developers'} in ${cc(s.countries)}. Look in these places:\n- ${lines(s.sources).join('\n- ')}\nFor each contact return one item with: name, company, city, country, phone, email (only if public), website or page, sourceUrl. At most ${s.maxPerRun} contacts.${s.requirePhone ? ' Only keep contacts that show a phone number.' : ''}`;
    case 'visibility':
      return `Ask each of these AI assistants: ${opt(bot, 'assistants', s.assistants)} — every question below, in a fresh session, for ${cc(s.countries)} in ${opt(bot, 'languages', s.languages)}.\nQuestions:\n- ${lines(s.questions).join('\n- ')}\nFor each answer return one item with: assistant, question, language, mentionsCasaLibre (true/false), wordsAboutCasaLibre (exact quote or null), competitorsNamed (in order, look for: ${lines(s.competitors).join(', ')}), sourcesCited (URLs), fullAnswer.`;
    case 'competitor-watch':
      // Tuned over 4 test rounds (Nov 23): short works (long jobs got dropped), X by the plain name
      // only (extra words find nothing), people's words over company news, exact dates and quotes.
      return [
        `Competitors (name | website):\n- ${lines(s.competitors).join('\n- ')}`,
        'Time window: news, X and LinkedIn from the last 30 days; reviews from the last 90 days. Give the exact date (YYYY-MM-DD) of every item and skip anything older.',
        `Where to look (${opt(bot, 'channels', s.channels)}): X — search each competitor's plain name only (e.g. "infocasas", no extra words) and read posts and replies from real people; news sites (ABC Color, Última Hora, La Nación, 5Días, MarketData, La Verdad Paraguaya); their public LinkedIn posts; Google Play / App Store reviews. Skip Facebook and Instagram if they need a login, and say so in the summary.`,
        `What counts: ${opt(bot, 'topics', s.topics)} — prefer what people say (owners, agents, buyers, tenants, press) over the company's own marketing. Never return plain property listings.`,
        'For each item return: competitor, channel, topic (features | prices | promotions | complaints | praise | news), sentiment (positive | negative | neutral), whoSaid (owner | agent | buyer | tenant | press | company | other), whatHappened (one plain sentence), quote (exact words, original language), rating (stars if a review, else null), date, sourceUrl. Aim for 4 items per competitor.',
        'Summary: per competitor the main complaint, the main praise and any price/plan change; then which channels worked and which were skipped.',
      ].join('\n');
    case 'analyst-x':
      return `Read X posts from the last ${s.lookbackHours} hours from these accounts (by country):\n- ${lines(s.accounts).join('\n- ')}\nCountries: ${cc(s.countries)}. At most ${s.maxPostsPerDay} posts. Keep posts about the economy, interest rates, housing, credit, property law, exchange rates or anything that could change how many people look for homes.\nFor each post return one item with: country, account, date, text, url.`;
    case 'news-feed':
      return `Collect today's outside events for ${cc(s.countries)} about: ${opt(bot, 'topics', s.topics)}.${s.useX ? ' Search X.' : ''}${s.useNews ? ' Search news sites.' : ''} At most ${s.maxPerCountry} items per country.\nFor each event return one item with: date, country, topic, headline, url.`;
    case 'football':
      return `Collect today's football news about:\n- ${lines(s.teams).join('\n- ')}\nSearch X and the web (results, line-ups, transfers, reactions). At most ${s.articlesPerDay * 3} news items.\nFor each return one item with: team, headline, whatHappened, date, sourceUrl. Do not write articles; only collect.`;
    default:
      return 'No task.';
  }
}

export function buildJob(botKey, stored, { runId, reportTo, token, test = false } = {}) {
  const bot = botByKey(botKey);
  if (!bot) throw new Error('unknown bot');
  const reportHeader = `Authorization: Bearer ${token}`;
  if (test) {
    return {
      runId, test: true, bot: bot.name,
      task: 'Connection test only. Do not open any website and do no other work. Immediately send the report with summary "Connection test OK" and an empty items list.',
      rules: GLOBAL_RULES, settings: {}, reportTo, reportHeader,
    };
  }
  const s = mergeBotSettings(bot, stored);
  return { runId, test: false, bot: bot.name, task: taskFor(bot, s), rules: [...GLOBAL_RULES, ...bot.rules], settings: s, reportTo, reportHeader };
}

// The bot's report → { runId, summary, items, failed } or { error }
export function parseReport(body) {
  if (!body || typeof body !== 'object') return { error: 'body must be JSON' };
  const runId = String(body.runId || '');
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return { error: 'runId missing or invalid' };
  const items = Array.isArray(body.items) ? body.items.filter((x) => x && typeof x === 'object').slice(0, MAX_ITEMS) : [];
  const summary = String(body.summary ?? body.error ?? '').slice(0, 4000);
  const failed = !!body.error || body.status === 'failed' || body.ok === false;
  return { runId, summary, items, failed };
}

// a stored run as the page shows it: an unanswered run past its time is "no answer"
export function runView(r, now = Date.now()) {
  const limit = (r.trigger === 'test' ? NO_ANSWER_MIN.test : NO_ANSWER_MIN.run) * 60000;
  const status = r.status === 'sent' && now - Date.parse(r.started_at) > limit ? 'no_answer' : r.status;
  return {
    id: r.id, bot: r.bot_key, trigger: r.trigger, status, summary: r.summary || null, items: r.items || [], itemCount: r.item_count || 0,
    error: r.error || null, approval: r.approval, approvedBy: r.approved_by || null, by: r.created_by || null, startedAt: r.started_at, reportedAt: r.reported_at || null,
  };
}

export const BOT_KEYS = BOTS.map((b) => b.key);
