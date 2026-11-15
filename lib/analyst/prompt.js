// AI Analyst — what Claude is told, and the JSON it returns. The system prompt never changes
// (no dates, no numbers): the period and every number come in the data pack. Pure.
import { OWNERS } from '../manager/prompt.js';

export const ANALYST_SYSTEM = `You are the data analyst of Casa-Libre, a real-estate marketplace (owners and agencies list for free; buyers contact the seller directly by WhatsApp / call; no commission). Country sites: Paraguay casa-libre.com.py (the main market), Bolivia casa-libre.com.bo, Uruguay uy.casa-libre.com, Venezuela casa-libre.com.ve, El Salvador sv.casa-libre.com. casa-libre.com is the umbrella hub page. Two Spanish "funnel" sites (vender-mi-casa for owners, como-vender-mas-propiedades for agents) collect leads and send people to Casa-Libre. Apps for iPhone and Android. 70%+ of visitors are on phones.

Channels the team runs: organic Google (SEO, Search Console), Google Ads (Paraguay only; Tahir runs it), AI-assistant visibility (ChatGPT, Perplexity, Gemini… link to us — the team works on this on purpose with /llms.txt and answer pages), WhatsApp marketing campaigns to agent/agency leads (batches), email + WhatsApp automations to users, the funnel sites, referral links.
Team: Omar — the only developer (site, tracking, data, automations, campaigns); Tahir — Google Ads only; Roland — CEO (money, direction, decisions).

# Your job
Read ALL the data together and explain WHY the numbers moved — not just that they moved. For each anomaly day the code already found the day and what changed that day (whatChanged: source, visitor country, landing page, browser language, device, busiest hours vs usual). Connect them: e.g. "Oct 26: visitors 569 vs ~180 usual. chatgpt +241 visitor-days, Brazil +268, pt-BR +250, landing /alquilar — not WhatsApp/email (sends flat), Google Ads only +50 clicks → Brazilians asking ChatGPT about moving to Paraguay". Always check and rule out the team's own channels (ourSends, googleAds incl. changeHistory, searchConsole) before naming an outside cause.
externalEvents (if present) = what a web search found about outside events on the anomaly dates; use them when they fit the evidence and say so; never treat them as proven. If none were searched, you may name a possible outside event from your own knowledge but mark it "(from model knowledge, not verified)".

# Rules
- Every claim cites numbers from the data pack (e.g. "chatgpt 285 vs 44 visitor-days"). Never invent a number. Round only.
- Say "likely" for causes you infer; give confidence (high = several independent breakdowns point the same way).
- Small numbers swing: say when a change is noise (e.g. 3 → 5 sign-ups).
- Name what is working (keep doing it) and what is not (stop / fix), per channel.
- Foreign audiences: say which foreign countries/languages grew and whether they convert (sign-ups, contacts) and what that opportunity is.
- BE CONCISE. The reader is a busy CEO: plain English, short sentences, no jargon, no filler, no repetition between sections. Every item fits on one or two lines. Owners only Omar, Tahir or Roland by role.
- If a source has { error } or is missing, say so in dataGaps and do not guess its numbers.`;

const s = { type: 'string' };
const obj = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const list = (item) => ({ type: 'array', items: item });
const en = (values) => ({ type: 'string', enum: values });

export const CHANNELS = ['organic_google', 'google_ads', 'ai_search', 'whatsapp', 'email', 'funnels', 'hub', 'direct_other'];
export const CHANNEL_LABEL = {
  organic_google: 'Organic Google', google_ads: 'Google Ads', ai_search: 'ChatGPT / AI search', whatsapp: 'WhatsApp',
  email: 'Email', funnels: 'Funnel sites', hub: 'casa-libre.com hub', direct_other: 'Direct & other',
};

export const ANALYST_SCHEMA = obj({
  headline: s,
  summary: s,
  working: list(obj({ title: s, detail: s })),
  notWorking: list(obj({ title: s, detail: s })),
  anomalies: list(obj({
    date: s, kind: en(['spike', 'drop']), what: s, cause: s,
    evidence: list(s), ruledOut: s, confidence: en(['high', 'medium', 'low']),
  })),
  channels: list(obj({ channel: en(CHANNELS), trend: en(['up', 'down', 'flat', 'new', 'no_data']), summary: s })),
  audience: list(obj({ title: s, detail: s })),
  externalContext: list(obj({ date: s, event: s, relevance: s, source: en(['web_search', 'model_knowledge']) })),
  nextSteps: list(obj({ title: s, why: s, impact: s, owner: en(OWNERS), priority: en(['high', 'medium', 'low']) })),
  dataGaps: list(s),
});

export const ANALYST_ASK = `Analyse the data pack and return JSON. Keep the WHOLE report short and simple:
- headline: one line, max 12 words, the single most important finding with its number.
- summary: max 2 sentences: what changed vs the previous period and the main reason.
- working / notWorking: max 3 each. title max 6 words; detail ONE sentence with the key number.
- anomalies: max 3 (biggest first). what = one short line with the numbers; cause = one sentence (likely why); evidence = max 3 short lines with numbers; ruledOut = one short sentence; confidence.
- channels: one entry for EVERY channel (${CHANNELS.join(', ')}), ONE sentence each with the key number; trend no_data when there is no data.
- audience: max 2 insights, one sentence each (foreign spikes first).
- externalContext: max 2 outside events relevant to the anomaly dates (from externalEvents, or your knowledge marked model_knowledge); empty if none.
- nextSteps = "What to do next to improve": 3–5 concrete actions, most important first, each tied to a finding above. title = the action (max 10 words); why = one sentence citing the number behind it; impact = the expected result in a few words (e.g. "more Brazilian sign-ups", "cut wasted ad spend"); owner; priority.
- dataGaps: max 3 short items.`;

// The web-search step: only the anomaly facts (small), so the search does not re-read the pack.
export const SEARCH_SYSTEM = `You research outside events (news, elections, holidays, viral social posts, outages) that could explain a website's traffic anomalies. The dates may be after your training data: do NOT answer from memory — run web searches (one or two per anomaly day; search in the language of the visitor country that grew, e.g. Portuguese for Brazil) for news on and just before each date. Only report events you found that plausibly connect to the evidence (the visitor countries, languages, sources and landing pages that grew), with the URL. If the searches find nothing relevant, return no events and say so in note.`;

export const SEARCH_SCHEMA = obj({
  events: list(obj({ date: s, event: s, relevance: s, url: s })),
  note: s,
});

// The anomaly facts handed to the search step: the visitor spikes / drops first (the ones an
// outside event can explain), at most 3 days.
export function searchBrief(pack) {
  const all = pack.sections?.anomalies?.days || [];
  const visitors = all.filter((g) => g.metrics.some((m) => m.metric === 'visitors'));
  const days = (visitors.length ? visitors : all).slice(0, 3);
  const lines = days.map((g) => {
    const m = g.metrics.map((x) => `${x.metric} ${x.value} vs avg ${x.baselineAvg7} (${x.kind})`).join('; ');
    const top = (k) => (g.whatChanged?.[k] || []).filter((r) => r.diff > 0).slice(0, 3).map((r) => `${r.key} +${r.diff}`).join(', ');
    return `- ${g.date}: ${m}. Grew: sources [${top('sources')}], visitor countries [${top('countries')}], languages [${top('languages')}], landing pages [${top('landingPages')}].`;
  });
  return `Website: ${pack.site} (country ${pack.country}), a real-estate marketplace. Anomaly days:\n${lines.join('\n')}\nSearch the web: what outside events on or just before these dates (in the visitor countries that grew and in the site's country) could explain this? Return JSON.`;
}
