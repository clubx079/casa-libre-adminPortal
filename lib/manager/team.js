// Admin Manager — the RESEARCH TEAM. Instead of one agent reading everything, five researchers
// each own one part of the business, work in parallel on their slice of the data pack (with
// the same read-only tools), and write their own section. Then the lead reads the five
// sections (no tools) and writes the briefing on top: headline, summary, the ranked
// priorities. The page shows the lead's overview + one tab per researcher.
//   feedback  — what people told us: ratings vs before, false flags, bots, replies to bad feedback
//   listings  — original (owner) listings: growth, rent vs sale, bad data, payments collected
//   followups — automations: delivery, bounces, opens, clicks, WhatsApp reads, send timing
//   growth    — traffic, sources, funnel, Google Ads
//   catalog   — scrapers and the scraped catalog
// Server-only.
import { systemPrompt, OWNERS, DRAFT_KINDS } from './prompt.js';
import { runAgent, emptyUsage, costUsd } from './agent.js';

const s = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (item) => ({ type: 'array', items: item });
const owner = { type: 'string', enum: OWNERS };
const CH = { type: 'string', enum: ['email', 'whatsapp', 'both', 'whatsapp_first'] };

export const RESEARCHERS = [
  {
    id: 'feedback',
    title: 'Feedback',
    role: 'the Feedback researcher',
    keys: ['feedback', 'claimChecks', 'suspicious', 'listingReports', 'users'],
    focus: `Your part: everything people told us — feedback ratings and messages, listing reports.
- Compare this week's ratings with the previous week AND with the previous report (previousReport): did feedback get better or worse? Give the numbers.
- claimChecks: give every item a verdict in claim_checks (confirmed / false_flag / unclear) with the exact reason from the records. No draft for a false flag.
- suspicious.botFeedback / botSignups: list every bot in suspicious (verdict bot); they never count in ratings and are never emailed.
- Draft a personal email for every genuine bad feedback (1–2★ or a complaint) that is confirmed or unclear and has an address.
Leave listings_data, payments and timing to the other researchers (empty lists).`,
  },
  {
    id: 'listings',
    title: 'Original listings & payments',
    role: 'the Original listings & payments researcher',
    keys: ['listings', 'catalog', 'drafts', 'payments', 'suspicious', 'users'],
    focus: `Your part: the ORIGINAL listings (published by owners/agencies on the site, origin = user) and the money.
- How much did original listings grow (new this week vs previous, all-time, first-time sellers)? Split rent vs sale and by type/city; compare with what buyers look for (use query_posthog on property_viewed mode/type if useful).
- Listing quality: suspicious.listingsWithImpossibleData — decide real_person_bad_data / bot / unclear for each (in suspicious, kind listing_data) and draft a listing_fix email for real people. Look for other bad listings with the tools if the numbers suggest it.
- Payments: are we collecting money? Paywall on or off, payments this week (paid / failed / abandoned), revenue, people stuck at payment, unfinished drafts (drafts.stuckOver3Days). Say plainly if no money is coming in and why.
- Drafts only for: listing_fix, stuck_draft, unpaid_listing, payment_problem.
Leave feedback claims, bots in feedback and message timing to the others (empty claim_checks and timing).`,
  },
  {
    id: 'followups',
    title: 'Follow-ups & messages',
    role: 'the Follow-ups researcher',
    keys: ['automations', 'emailEngagement', 'messageTiming'],
    focus: `Your part: every automated email and WhatsApp.
- followups: a verdict per automation and channel (working / weak / no_effect / too_early / costly) from automations.followUpsPreviousWeekFullResults.
- timing: per automation and channel from messageTiming — bounce rate, open rate (inflated by Apple Mail), click rate (honest), WhatsApp read rate, which local send hours work, how long people take to act (actedAfter), and for draft reminders how old the draft was. Then: should the delay change (e.g. 24 h → 6 h) or the send hour? Give the numbers and a confidence; say when there is too little data.
- WhatsApp: when automations use WhatsApp (whatsapp / both / whatsapp_first), judge read rates and whether the cost (~US$0.07 a marketing message) is earned.
No drafts. Leave claims, bots and listings to the others.`,
  },
  {
    id: 'growth',
    title: 'Traffic & marketing',
    role: 'the Traffic & marketing researcher',
    keys: ['traffic', 'googleAds', 'users', 'buyerContacts'],
    focus: `Your part: people coming to the site and the app, and what marketing brings.
- Visitors, sources (first touch), devices, the funnel (visit → search → view → contact / list), buyer → seller contacts, sign-ups. This week vs previous.
- Demand: what buyers look for (rent vs sale, type, city) — useful for ads and for sellers.
- Google Ads (Paraguay): spend, clicks, real conversions vs Google's own count (soft goals inflate it), search terms that waste money. Ads work is Tahir's; site/tracking work is Omar's; budget decisions are Roland's.
No drafts. Leave feedback, listings, payments and messages to the others.`,
  },
  {
    id: 'catalog',
    title: 'Scrapers & catalog',
    role: 'the Scrapers & catalog researcher',
    keys: ['scrapers', 'catalog'],
    focus: `Your part: the scraped catalog.
- Each scraper's health from scrape_runs and live listing counts (not last_run_at alone — one shared cron since mid-October). Which stopped, which are thin, which grow.
- Catalog size: live scraped vs original listings, rent vs sale, quarantine (only if it jumped).
- Remember InfoCasas and Tu Lugar were removed on purpose.
No drafts. Leave everything else to the others.`,
  },
];

// Each researcher's own JSON format: the shared basics + only the lists its area uses (one
// schema with every list is too large for the API's structured-output grammar).
// ids / button fields are plain strings ("" = none): nullable fields make the grammar too large.
const PARTS = {
  claim_checks: list(obj({ who: s, claim: s, verdict: { type: 'string', enum: ['confirmed', 'false_flag', 'unclear'] }, reason: s, evidence: s, feedback_id: s, user_id: s })),
  suspicious: list(obj({ kind: { type: 'string', enum: ['bot_feedback', 'bot_signup', 'listing_data', 'spam'] }, verdict: { type: 'string', enum: ['bot', 'real_person_bad_data', 'unclear'] }, title: s, reason: s, action: s, feedback_id: s, user_id: s, property_id: s })),
  followups: list(obj({ automation: s, channel: CH, verdict: { type: 'string', enum: ['working', 'weak', 'no_effect', 'too_early', 'costly'] }, evidence: s, recommendation: s })),
  timing: list(obj({ automation: s, channel: CH, current: s, numbers: s, finding: s, recommendation: s, confidence: { type: 'string', enum: ['high', 'medium', 'low'] } })),
  drafts: list(obj({ kind: { type: 'string', enum: DRAFT_KINDS }, user_id: s, feedback_id: s, property_id: s, reason: s, evidence: s, subject: s, heading: s, body: s, button_label: s, button_url: s })),
};
const EXTRA = { feedback: ['claim_checks', 'suspicious', 'drafts'], listings: ['suspicious', 'drafts'], followups: ['followups', 'timing'], growth: [], catalog: [] };
export function sectionSchema(id) {
  const props = {
    headline: s,
    points: list(s),
    trend: { type: 'string', enum: ['better', 'worse', 'steady', 'mixed', 'too_early'] },
    positives: list(obj({ title: s, detail: s, evidence: s })),
    negatives: list(obj({ title: s, detail: s, evidence: s, severity: { type: 'string', enum: ['high', 'medium', 'low'] } })),
    recommendations: list(obj({ title: s, why: s, how: s, impact: { type: 'string', enum: ['high', 'medium', 'low'] }, effort: { type: 'string', enum: ['small', 'medium', 'large'] }, owner })),
    team_tasks: list(obj({ task: s, owner, why: s })),
    data_issues: list(obj({ title: s, detail: s })),
  };
  for (const k of EXTRA[id] || []) props[k] = PARTS[k];
  return obj(props);
}

export const LEAD_SCHEMA = obj({
  headline: s,
  points: list(s),
  priorities: list(obj({ section: s, title: s, why: s, how: s, impact: { type: 'string', enum: ['high', 'medium', 'low'] }, effort: { type: 'string', enum: ['small', 'medium', 'large'] }, owner })),
});

// The part of the data pack one researcher sees (+ the shared basics).
export function slicePack(pack, keys) {
  const out = { country: pack.country, site: pack.site, period: pack.period, previousPeriod: pack.previousPeriod, notes: pack.notes, kpis: pack.kpis, previousReport: pack.previousReport };
  for (const k of keys) if (pack[k] !== undefined) out[k] = pack[k];
  return out;
}

const researcherSystem = (country, r) => `${systemPrompt(country)}

# Your role this week: ${r.role}
You are one of five researchers; each writes one section of the weekly report and a lead combines them. Stay in your area — the others cover the rest.
${r.focus}
Keep it tight: about 5–15 tool lookups, only where a number needs explaining or a person needs a message.`;

const LEAD_SYSTEM = (country) => `${systemPrompt(country)}

# Your role this week: the lead
Five researchers each wrote one section (feedback, original listings & payments, follow-ups & messages, traffic & marketing, scrapers & catalog). You do not research: you read their sections and write the briefing on top.
- headline: the one thing the team must know this week (max 12 words).
- points: 3–5 bullets across all sections (max 15 words each): what got better, worse, what first.
- priorities: the 5–7 most important actions (title max 10 words, why/how max 20 words each) from ALL sections, ranked by impact, each with its section id and an owner (Omar = all building/fixing/data/messages, Tahir = Google Ads only, Roland = decisions and money only). Merge duplicates. Never list a false flag or a bot as a problem.`;

// Run the team. onProgress({ who, text }) for the page's live log.
export async function runTeam({ country, pack, deps, onProgress = async () => {} }) {
  const usage = emptyUsage();
  const sum = (u) => { for (const k of Object.keys(usage)) usage[k] += u[k] || 0; };
  const results = await Promise.all(RESEARCHERS.map(async (r) => {
    try {
      const res = await runAgent({
        country, deps,
        pack: slicePack(pack, r.keys),
        system: researcherSystem(country, r),
        schema: sectionSchema(r.id),
        firstMessage: `Here is the data for your area (JSON above). Research it as ${r.role}: investigate what needs it, prepare drafts only where your role allows. When done, write your findings as a short plain-text note.`,
        finalMessage: `Now write your section as JSON in the required format. Only your area. Very short: headline max 12 words, 3–5 points max 15 words each, max 5 items per list. Most important first. Owners only Omar, Tahir or Roland by their roles.`,
        maxTurns: 8,
        maxUsd: 1.5,
        onProgress: async ({ turn, tools, costUsd: c }) => onProgress({ who: r.title, text: `step ${turn}: ${tools.map((t) => t.name).join(', ')} (US$${c.toFixed(2)})` }),
      });
      sum(res.usage);
      await onProgress({ who: r.title, text: `section written (US$${res.costUsd.toFixed(2)})` });
      return { r, ok: true, section: res.report, notes: res.notes, model: res.model };
    } catch (e) {
      await onProgress({ who: r.title, text: `failed: ${String(e?.message || e).slice(0, 200)}` });
      return { r, ok: false, error: String(e?.message || e).slice(0, 300) };
    }
  }));
  if (!results.some((x) => x.ok)) throw new Error(`Every researcher failed: ${results.map((x) => `${x.r.id}: ${x.error}`).join(' | ').slice(0, 600)}`);

  const sections = results.map((x) => (x.ok
    ? { id: x.r.id, title: x.r.title, ...x.section }
    : { id: x.r.id, title: x.r.title, failed: true, error: x.error }));
  await onProgress({ who: 'Lead', text: 'combining the five sections…' });
  const brief = sections.map(({ drafts, ...rest }) => ({ ...rest, drafts: (drafts || []).length }));
  const lead = await runAgent({
    country, deps, pack: { sections: brief, kpis: pack.kpis, period: pack.period },
    system: LEAD_SYSTEM(country), schema: LEAD_SCHEMA, withTools: false, maxTurns: 1, maxUsd: 1,
    firstMessage: 'Here are the five researchers\' sections (JSON above). Read them and note what matters most across them.',
    finalMessage: 'Now write the briefing as JSON: headline, points, priorities. Very short.',
  });
  sum(lead.usage);

  // One report: the lead's briefing + every section's lists (tagged with their section),
  // so the page can show the overview and each researcher's tab.
  const tag = (key) => sections.flatMap((x) => (x[key] || []).map((v) => ({ ...v, section: x.id })));
  const report = {
    headline: lead.report.headline,
    points: lead.report.points,
    recommendations: lead.report.priorities.map(({ section, ...p }) => ({ ...p, section })),
    sections: sections.map(({ drafts, ...rest }) => rest),
    positives: tag('positives'),
    negatives: tag('negatives'),
    followups: tag('followups'),
    timing: tag('timing'),
    claim_checks: tag('claim_checks'),
    suspicious: tag('suspicious'),
    team_tasks: tag('team_tasks'),
    data_issues: tag('data_issues'),
    section_recommendations: tag('recommendations'),
    drafts: sections.flatMap((x) => (x.drafts || []).map((d) => ({ ...d, section: x.id }))),
  };
  const notes = results.filter((x) => x.ok && x.notes).map((x) => `## ${x.r.title}\n${x.notes}`).concat(lead.notes ? [`## Lead\n${lead.notes}`] : []).join('\n\n');
  return { report, notes, usage, costUsd: costUsd(usage), model: lead.model };
}
