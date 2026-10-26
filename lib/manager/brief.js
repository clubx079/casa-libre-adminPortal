// Admin Manager — the ANALYST: one Claude call (no tools: the data pack already holds every
// number) that reads the pack, the open actions of the earlier reports, the admins' notes
// and the standing memory, and returns the brief as JSON:
//   headline + points, ONE ranked action list (owner, why, how, the data fields it rests on),
//   a verdict on every open action from earlier reports (fixed / improving / still open / worse),
//   what to send Tahir, the checked complaints and bots, the draft emails, which notes it
//   applied and lessons worth remembering.
// The code then checks every number (lib/manager/verify.js) and carries the loop forward
// (lib/manager/memory.js). Replaces the five researchers + lead (about US$3 a run → well
// under US$1). Server-only.
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt, OWNERS, DRAFT_KINDS } from './prompt.js';
import { addUsage, emptyUsage, costUsd, parseReport } from './agent.js';

export const BRIEF_MODEL = process.env.MANAGER_MODEL || 'claude-opus-5-5';
const EFFORT = process.env.MANAGER_EFFORT || 'medium';
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

export const AREAS = ['feedback', 'listings', 'payments', 'messages', 'growth', 'ads', 'catalog', 'data'];
export const CHECK_STATUS = ['fixed', 'improving', 'still_open', 'worse', 'unclear'];
// The specialist areas: each gets a short section of its own (one tab on the page).
// An action's area → its section: listings+payments → listings, growth+ads → growth.
export const SECTIONS = [
  ['feedback', 'Feedback', 'feedback, claimChecks, suspicious, listingReports'],
  ['listings', 'Listings & payments', 'listings, catalog (owner side), drafts, payments'],
  ['messages', 'Messages', 'automations, emailEngagement, messageTiming'],
  ['growth', 'Traffic & ads', 'traffic, googleAds, buyerContacts, users'],
  ['catalog', 'Scrapers', 'scrapers, catalog'],
];
export const SECTION_OF = { feedback: 'feedback', listings: 'listings', payments: 'listings', messages: 'messages', growth: 'growth', ads: 'growth', catalog: 'catalog' };

const s = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (item) => ({ type: 'array', items: item });
const en = (values) => ({ type: 'string', enum: values });

// ids / button fields are plain strings ("" = none): nullable fields make the grammar too large.
export const BRIEF_SCHEMA = obj({
  headline: s,
  points: list(s),
  actions: list(obj({
    key: s, title: s, owner: en(OWNERS), area: en(AREAS), why: s, how: s,
    impact: en(['high', 'medium', 'low']), effort: en(['small', 'medium', 'large']),
    status: en(['new', 'still_open', 'worse']), facts: list(s),
  })),
  followup_checks: list(obj({ key: s, status: en(CHECK_STATUS), evidence: s, facts: list(s) })),
  tahir: obj({ facts: list(s), actions: list(s) }),
  claim_checks: list(obj({ who: s, claim: s, verdict: en(['confirmed', 'false_flag', 'unclear']), reason: s, evidence: s, feedback_id: s, user_id: s })),
  suspicious: list(obj({ kind: en(['bot_feedback', 'bot_signup', 'listing_data', 'spam']), verdict: en(['bot', 'real_person_bad_data', 'unclear']), title: s, reason: s, action: s, feedback_id: s, user_id: s, property_id: s })),
  drafts: list(obj({ kind: en(DRAFT_KINDS), user_id: s, feedback_id: s, property_id: s, reason: s, evidence: s, subject: s, heading: s, body: s, button_label: s, button_url: s })),
  notes_applied: list(s),
  memory_suggestions: list(s),
  data_issues: list(obj({ title: s, detail: s })),
  sections: list(obj({ id: en(SECTIONS.map(([id]) => id)), headline: s, trend: en(['better', 'worse', 'steady', 'mixed', 'too_early']), points: list(s), facts: list(s) })),
});

export const BRIEF_RULES = `
# This run: you are the whole Admin Manager — one brief, not a long report
The report covers period.days days: the time since the last report (Monday, Wednesday, Friday). "thisWeek" / "previousWeek" keys in the pack mean this period / the previous period of the same length. Say "since the last report" / "vs the previous period", never "this week" and never a weekday unless it is in the data.
You have NO tools. Everything you may use is in the message: the data pack (this period vs the previous one), the earlier reports (open actions, the admins' notes) and the team memory. Work only from that.

## Memory and admin notes come first
- memory = standing notes from the admins and lessons they accepted. They are true. Follow every one; never contradict them.
- history.adminNotes = notes and 👍/👎 the admins left on earlier reports. A 👎 or a note saying something is wrong, known, or handled → do not raise it again unless the numbers show it got worse. A note that gives context → use it.
- notes_applied: one short line (max 12 words) for each memory note or admin note that changed what you wrote ("Skipped the KM7 listing: admin note says it is a real place").

## The loop — check what earlier reports asked for
- history.openActions = actions earlier reports raised and nobody closed. For EVERY one, add a followup_checks entry with its key: fixed / improving / still_open / worse / unclear, evidence with the numbers, facts = the data fields you used.
- marked_done_by_admin = an admin says it is done: confirm with the numbers (fixed) or say it is not (still_open / worse).
- Raise an open action again in actions ONLY if it is still the most important thing; then reuse its key and set status still_open or worse.

## actions — ONE ranked list, most important first, at most 6
- key: reuse the key of the same issue from history.openActions; otherwise a new short kebab-case key (3–6 words).
- title max 8 words, starting with a verb. why max 12 words WITH the number(s). how max 12 words: the concrete next step.
- owner by role (Omar builds/fixes/data/messages; Tahir Google Ads only; Roland decisions and money only).
- ONE thing per action: one fix, or ONE decision for Roland (never "decide X, Y and Z" — split them, most important first).
- facts: 1–6 data pack paths for EVERY number in title and why (a number not covered by its facts is flagged), written exactly as in the pack, e.g. "listings.newThisWeek.total", "automations.sentThisWeek.email", "traffic.funnel.Visited.thisWeek" (array entries by their step / automation / type), "messageTiming.rows.no_listing_nudge.clickRate".
- Never list a false flag or a bot as a problem. Skip anything memory or notes say is known/handled.

## tahir — what to send Tahir for the ad campaign (Google Ads only)
facts: 3 short lines with numbers (spend, clicks, real conversions, what buyers look for, wasted search terms). actions: 2–3 direct instructions (max 12 words each) he can do in Google Ads. Empty lists if there is no Ads data.

## Every number must be real
Copy numbers exactly from the data pack / history (you may round, or give a difference / percentage of two numbers that are next to each other in the pack). Never estimate, never invent. The code checks every number and removes what it cannot find. If a number is missing, say "not measured".

## memory_suggestions
0–2 short lessons (max 15 words) worth remembering for future runs that the data or the notes taught you (e.g. "Draft reminders sent at night get no clicks"). An admin decides whether to keep them.

## sections — one short section per area, as that area's specialist would write it
Exactly one per area: ${SECTIONS.map(([id, , keys]) => `${id} (${keys})`).join('; ')}.
headline max 10 words; trend vs the previous period; points 2–3 lines, max 12 words each, with the numbers; facts = the data pack paths of EVERY number in headline and points (unchecked numbers are removed). Do not repeat the actions.

## Also
- headline max 10 words; points 3–4 lines, max 12 words each. Evidence max 12 words. No filler, no repeats across sections.
- claim_checks: a verdict for every claimChecks item. suspicious: every bot and every listing with impossible data.
- drafts: personal emails only where a specific person needs one (same rules as above), at most 6.
- payments.thisWeek.abandonedCheckouts = people who opened the card form and did not pay: report the count, and draft a short, kind unpaid_listing email (offer help, no pressure) for up to 3 of them.
- data_issues: only real tracking/data gaps, max 3.`;

// The data pack without what the AI does not need (template ids, timestamps of settings…).
export function slimPack(pack) {
  const p = { ...pack };
  if (p.automations?.settings) {
    p.automations = {
      ...p.automations,
      settings: p.automations.settings.filter((x) => x.id !== 'manager_memory').map(({ id, channel, enabled, wait_days, milestones, free_days }) => ({ id, channel, enabled, wait_days, milestones, free_days })),
    };
  }
  delete p.generatedAt;
  delete p.previousReport;
  return p;
}

// The brief's JSON format in two parts: one schema with everything is too large for the
// API's structured-output grammar ("compiled grammar is too large").
const part = (keys) => ({ ...BRIEF_SCHEMA, properties: Object.fromEntries(keys.map((k) => [k, BRIEF_SCHEMA.properties[k]])), required: keys });
export const BRIEF_PARTS = [
  { keys: ['headline', 'points', 'actions', 'followup_checks', 'tahir', 'notes_applied', 'memory_suggestions', 'data_issues'], ask: 'Write the brief as JSON: headline, points, actions, followup_checks, tahir, notes_applied, memory_suggestions, data_issues.' },
  { keys: ['sections'], ask: 'Now only the sections, as JSON: one short section per area (feedback, listings, messages, growth, catalog).' },
  { keys: ['claim_checks', 'suspicious', 'drafts'], ask: 'Now only the checks and the emails, as JSON: claim_checks (a verdict for every claimChecks item), suspicious (every bot and listing with impossible data), drafts (personal emails where a specific person needs one; never for a false flag or a bot).' },
].map((p) => ({ ...p, schema: part(p.keys) }));

// One call per part on the same input (memory, earlier reports, data pack). → { brief, usage, costUsd, model }
export async function runBrief({ country, pack, history, memory }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 10 * 60 * 1000, maxRetries: 3 });
  const input = [
    { type: 'text', text: `Team memory (always true):
${JSON.stringify(memory.map((n) => n.text))}` },
    { type: 'text', text: `Earlier reports (the loop):
${JSON.stringify(history)}` },
    { type: 'text', text: `Data pack (JSON):
${JSON.stringify(slimPack(pack))}` },
  ];
  const system = [{ type: 'text', text: `${systemPrompt(country, { tools: false })}
${BRIEF_RULES}` }];
  const usage = emptyUsage();
  let fallback = true;
  let model = BRIEF_MODEL;
  const ask = async ({ schema, ask: text }) => {
    const params = {
      model: BRIEF_MODEL,
      max_tokens: 24000,
      system,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT, format: { type: 'json_schema', schema } },
      messages: [{ role: 'user', content: [...input, { type: 'text', text }] }],
    };
    let msg;
    try {
      msg = fallback ? await client.beta.messages.stream({ ...params, ...FALLBACK }).finalMessage() : await client.messages.stream(params).finalMessage();
    } catch (e) {
      if (!(fallback && e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message)))) throw e;
      fallback = false;
      msg = await client.messages.stream(params).finalMessage();
    }
    addUsage(usage, msg.usage);
    if (msg.stop_reason === 'refusal') throw new Error(`The model declined (${msg.stop_details?.category || 'no category'})`);
    if (msg.stop_reason === 'max_tokens') throw new Error('The brief was cut off (max_tokens)');
    model = msg.model || model;
    return parseReport(msg);
  };
  const brief = {};
  // in parallel: each part has its own output format, which changes the prompt prefix, so a
  // shared prompt cache never hits (measured: cache read 0) — caching would only add 25% writes
  for (const part of await Promise.all(BRIEF_PARTS.map(ask))) Object.assign(brief, part);
  return { brief, usage, costUsd: costUsd(usage), model };
}
