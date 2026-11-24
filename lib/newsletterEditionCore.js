// The weekly newsletter EDITION generator — the pure parts (no DB, no fetch, no env):
// when an edition is due, what Claude is asked, and the validation every generated edition must
// pass before it is published. lib/newsletterEditionRun.js does the I/O. test/newsletterEdition.test.js.
//
// An edition = { week: '2026-W49', date: '2026-12-01', issues: [ISSUE], stories: [12 × STORY] },
// stored in newsletter_editions (website migration 026), shown by the website at /newsletter
// (newest) and /newsletter/<date>, and used by that week's weekly_newsletter email.
//   STORY = exactly the website's STORIES shape: { slug, metric, when, who, title, challenge, did,
//           result, quote } — each text { es, en }.
//   ISSUE = the website's ISSUES shape: { slug, cat, audience, name, subject, heading, body: [paragraphs],
//           button_label, button_url, story?, en: { subject, heading, body: [paragraphs] } }.
//           Numbers are NEVER written into the copy: {{nl_*}} placeholders, filled by the website
//           with the numbers measured for the edition's date (as the hand-made issues).
// Content rules (hard): no business other than Casa-Libre is named or linked; "Casa-Libre" with
// the hyphen; no opt-out / BAJA / unsubscribe line; no emojis; the app always "para iPhone y
// Android"; no banned claims (Marketing Formula). An edition that fails any rule is not published.
import { STATIC_STORIES, EXAMPLE_STORIES, EXAMPLE_ISSUES, COUNTRY_FACTS } from './newsletterEditionSeed.js';

export const STORY_COUNT = 12;
export const ISSUE_MIN = 2;
export const ISSUE_MAX = 3;
export const MAX_ATTEMPTS = 3;            // failed generations per week before the week is skipped
export const LEAD_HOURS = 3;              // generated this many hours before the weekly email
export const STALE_MINUTES = 20;          // a 'generating' claim older than this = a crashed run
export const ISSUE_CATS = ['data', 'sellers', 'tips', 'story', 'rent', 'app'];
export const AUDIENCES = ['everyone', 'sellers', 'buyers', 'never_listed'];
// the button labels the website knows (its English labels live in components/NewsletterContent.js)
export const BUTTONS = {
  'Publicar mi propiedad': '{{publish_url}}', 'Publicar mi primera propiedad': '{{publish_url}}', 'Publicar mi alquiler': '{{publish_url}}',
  'Publicar mis propiedades': '{{publish_url}}', 'Completar mi perfil': '{{settings_url}}', 'Ver lo que buscan los compradores': '{{search_url}}',
  'Descargar la app': '{{app_url}}',
};
export const NUMBER_VARS = ['nl_people_30d', 'nl_views_30d', 'nl_top_cities', 'nl_top_searches', 'nl_top_types', 'nl_sale_median', 'nl_sale_under_100k_pct',
  'nl_rent_band', 'nl_rent_band_pct', 'nl_rent_searches', 'nl_sale_searches', 'nl_direct_ratio', 'nl_photo_ratio', 'active_listings'];
const LINK_VARS = ['publish_url', 'settings_url', 'search_url', 'app_url', 'newsletter_url', 'stories_url'];
const TEXT_VARS = ['name', 'country_name'];
const KNOWN_VARS = new Set([...NUMBER_VARS, ...LINK_VARS, ...TEXT_VARS]);

// Businesses never named (on top of each country's local sites in COUNTRY_FACTS).
const GENERIC_BUSINESSES = ['InfoCasas', 'Clasipar', 'RE/MAX', 'Remax', 'Century 21', 'Properati', 'Mercado Libre', 'MercadoLibre', 'UltraCasas', 'Gallito',
  'Tuinmueble', 'Encuentra24', 'Zillow', 'Idealista', 'Facebook', 'Instagram', 'TikTok', 'OLX', 'Airbnb', 'Booking', 'Keller Williams',
  'Coldwell', 'Sotheby', 'Habitamia', 'Tu Lugar', 'Google', 'YouTube', 'Telegram', 'Craigslist', 'Ueno', 'Itaú', 'Visión Banco', 'Banco Continental', 'Bancard', 'Tigo'];

// ── when ──────────────────────────────────────────────────────────────────────
const ZONE = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador' };
const DAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// same as the website's lib/automations/newsletter.js localParts / isoWeek
export function localParts(now, country = 'py') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE[country] || ZONE.py, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: 'numeric', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { weekday: DAYS[parts.weekday], hour: Number(parts.hour) % 24, date: `${parts.year}-${parts.month}-${parts.day}` };
}
export function isoWeek(date) {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const week = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}
// The edition this moment belongs to (country time): its ISO week and its date.
export const editionSlot = (now, country = 'py') => { const p = localParts(now, country); return { week: isoWeek(p.date), date: p.date, local: p }; };

// Is this week's edition due? settings = lib/newsletterAdmin.js newsletterSettings(row);
// rows = this country's newsletter_editions rows of THIS week ({ status, created_at }).
// → { due, reason, week, date }   reasons: off | exists | generating | gave_up | not_yet | due
// Due from LEAD_HOURS before the weekly email (its day + hour, country time) until the week ends,
// so the edition is there when the email goes; force (the admin's "Generate now") skips the time.
export function editionDue({ settings, rows = [], now = new Date(), country = 'py', force = false }) {
  const { week, date, local } = editionSlot(now, country);
  const out = (due, reason) => ({ due, reason, week, date });
  if (!force && !(settings && settings.setUp && settings.autogen)) return out(false, 'off');
  const mine = rows.filter((r) => !r.week || r.week === week);
  if (mine.some((r) => r.status === 'published')) return out(false, 'exists');
  if (mine.some((r) => r.status === 'generating' && !isStale(r, now))) return out(false, 'generating');
  if (!force && mine.filter((r) => r.status === 'failed').length >= MAX_ATTEMPTS) return out(false, 'gave_up');
  if (!force) {
    const ord = (wd, h) => (wd === 0 ? 7 : wd) * 24 + h;   // Monday first, like the ISO week
    if (ord(local.weekday, local.hour) < ord(settings.day, settings.hour) - LEAD_HOURS) return out(false, 'not_yet');
  }
  return out(true, 'due');
}
export const isStale = (row, now = new Date()) => now - new Date(row?.created_at || 0) > STALE_MINUTES * 60000;

// ── never repeat ─────────────────────────────────────────────────────────────
const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const firstName = (who) => String(who || '').split(' · ')[0].trim();
// Everything used before: the 60 hand-made stories + every stored edition's stories.
// editions = newsletter_editions rows (newest first) with .stories. First names: all of them while
// the list is under 400 names; after that only the newest 300 (Spanish first names would run out).
export function usedBefore(editions = []) {
  const slugs = new Set(STATIC_STORIES.map((s) => s.slug));
  const titles = new Set(STATIC_STORIES.map((s) => fold(s.title)));
  const names = [];
  for (const e of editions) for (const s of Array.isArray(e?.stories) ? e.stories : []) {
    if (s?.slug) slugs.add(String(s.slug));
    if (s?.title?.es) titles.add(fold(s.title.es));
    if (s?.who?.es) names.push(fold(firstName(s.who.es)));
  }
  names.push(...STATIC_STORIES.map((s) => fold(s.name)).reverse());
  const uniq = [...new Set(names)];
  return { slugs, titles, names: new Set(uniq.length > 400 ? uniq.slice(0, 300) : uniq) };
}

// ── validation ───────────────────────────────────────────────────────────────
const EMOJI = /\p{Extended_Pictographic}|[\u{1F1E6}-\u{1F1FF}]|️/u;
const OPT_OUT = /\bBAJA\b|unsubscrib|darte de baja|dar(se)? de baja|desuscrib|opt.?out|dejar de recibir|no (quer[eé]s|deseas) recibir/i;
const BANNED_CLAIMS = /\bla mejor\b|\bel mejor\b|mayor crecimiento|gratis para siempre|\bthe best\b|fastest.growing|free forever/i;
const URLISH = /https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|py|bo|uy|ve|sv|io|app)\b/i;
const APP = /\bapps?\b|\baplicaci[oó]n\b/i;
const PLACEHOLDER = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');

export function businessPattern(country = 'py') {
  const local = COUNTRY_FACTS[country]?.competitors || [];
  // "RE/MAX Paraguay" → also "RE/MAX"; "Century 21 Bolivia" → "Century 21"
  const names = new Set([...GENERIC_BUSINESSES, ...local, ...local.map((n) => n.replace(/\s+(Paraguay|Bolivia|Uruguay|Venezuela|El Salvador|Inmuebles)$/i, ''))]);
  return new RegExp(`(^|[^\\p{L}])(${[...names].filter(Boolean).map(esc).join('|')})(?![\\p{L}])`, 'iu');
}

// One text: the rules every generated string obeys. → [problems]
export function textProblems(text, { where = '', country = 'py' } = {}) {
  const t = String(text ?? '');
  const out = [];
  const bad = (m) => out.push(`${where}: ${m}`);
  if (EMOJI.test(t)) bad('no emojis');
  if (/Casa\s+Libre|CasaLibre/i.test(t)) bad('write the brand as "Casa-Libre"');
  if (OPT_OUT.test(t)) bad('no opt-out / BAJA / unsubscribe line');
  if (BANNED_CLAIMS.test(t)) bad('banned claim ("la mejor", "mayor crecimiento", "gratis para siempre")');
  const plain = t.replace(PLACEHOLDER, '');
  if (URLISH.test(plain)) bad('no web address');
  const biz = businessPattern(country).exec(plain);
  if (biz) bad(`names another business ("${(biz[2] || biz[0]).trim()}") — only Casa-Libre may be named`);
  else if (/\bBanco\s+(?!de\s|del\s|el\s|la\s)\p{Lu}/u.test(plain)) bad('names a bank — say "el banco"');
  if (APP.test(plain) && !(/iPhone/.test(plain) && /Android/.test(plain))) bad('when the app is mentioned, say "para iPhone y Android" (both) in the same sentence or paragraph');
  return out;
}

const STORY_FIELDS = { metric: 40, when: 70, who: 70, title: 130, challenge: 360, did: 360, result: 320, quote: 220 };
const SLUG = /^[a-z]+(?:-[a-z0-9]+){1,5}$/;

// → { ok, errors, stories } — stories cleaned to exactly the STORY shape.
export function validateStories(list, { country = 'py', used = usedBefore([]) } = {}) {
  const errors = [];
  if (!Array.isArray(list)) return { ok: false, errors: ['stories: not a list'], stories: [] };
  if (list.length !== STORY_COUNT) errors.push(`stories: exactly ${STORY_COUNT} needed, got ${list.length}`);
  const stories = [];
  const seenSlug = new Set();
  const seenName = new Set();
  for (const [i, s] of list.entries()) {
    const at = `story ${i + 1}${s?.slug ? ` (${s.slug})` : ''}`;
    const clean = { slug: String(s?.slug || '').trim() };
    if (!SLUG.test(clean.slug)) errors.push(`${at}: slug must be lowercase ASCII words joined by "-", starting with the first name`);
    for (const [f, max] of Object.entries(STORY_FIELDS)) {
      clean[f] = {};
      for (const lang of ['es', 'en']) {
        const v = typeof s?.[f]?.[lang] === 'string' ? s[f][lang].trim() : '';
        if (!v) errors.push(`${at}: ${f}.${lang} missing`);
        else if (v.length > max) errors.push(`${at}: ${f}.${lang} longer than ${max} characters`);
        if (/\{\{/.test(v)) errors.push(`${at}: ${f}.${lang} has a {{placeholder}}`);
        if (/^["“”«]|["“”»]$/.test(v) && f === 'quote') errors.push(`${at}: quote.${lang} without quotation marks`);
        errors.push(...textProblems(v, { where: `${at} ${f}.${lang}`, country }));
        clean[f][lang] = v;
      }
    }
    const name = firstName(clean.who.es);
    if (!/ · /.test(clean.who.es) || !/ · /.test(clean.who.en)) errors.push(`${at}: who must be "<first name> · <role>"`);
    if (firstName(clean.who.en) !== name) errors.push(`${at}: who.en must start with the same first name`);
    if (name && !clean.slug.startsWith(fold(name).replace(/[^a-z]+/g, '-').replace(/^-|-$/g, '').split('-')[0])) errors.push(`${at}: slug must start with the first name`);
    if (used.slugs.has(clean.slug) || seenSlug.has(clean.slug)) errors.push(`${at}: slug already used`);
    if (used.names.has(fold(name)) || seenName.has(fold(name))) errors.push(`${at}: first name "${name}" already used — pick another`);
    if (used.titles.has(fold(clean.title.es))) errors.push(`${at}: title already used`);
    seenSlug.add(clean.slug);
    seenName.add(fold(name));
    stories.push(clean);
  }
  // variety: owners, agents and agencies, and several cities of this country
  const roles = stories.map((s) => fold(s.who.es.split(' · ')[1] || ''));
  const count = (re) => roles.filter((r) => re.test(r)).length;
  if (count(/duen[oa]|propietari/) < 2) errors.push('variety: at least 2 stories of owners ("dueño/dueña de …")');
  if (count(/\bagente\b/) < 2) errors.push('variety: at least 2 stories of agents ("agente …")');
  if (count(/inmobiliaria|desarrollador|constructor/) < 2) errors.push('variety: at least 2 stories of agencies or developers ("inmobiliaria …")');
  const cities = COUNTRY_FACTS[country]?.cities || [];
  const all = fold(stories.map((s) => `${s.when.es} ${s.title.es} ${s.challenge.es} ${s.did.es}`).join(' '));
  const seen = cities.filter((c) => all.includes(fold(c)));
  const needCities = Math.min(5, cities.length);
  if (seen.length < needCities) errors.push(`variety: name at least ${needCities} different cities of ${COUNTRY_FACTS[country]?.name || country} (found ${seen.length})`);
  return { ok: errors.length === 0, errors: [...new Set(errors)], stories };
}

const varsIn = (s) => [...String(s || '').matchAll(PLACEHOLDER)].map((m) => m[1]);
const LITERAL_NUMBER = /US\$\s?\d|\d\s?%|\b\d{1,3}(?:[.,]\d{3})+\b/;

// → { ok, errors, issues } — vars = this week's measured numbers (insightVars); storySlugs = the edition's stories.
export function validateIssues(list, { country = 'py', vars = {}, storySlugs = [] } = {}) {
  const errors = [];
  if (!Array.isArray(list)) return { ok: false, errors: ['issues: not a list'], issues: [] };
  if (list.length < ISSUE_MIN || list.length > ISSUE_MAX) errors.push(`issues: ${ISSUE_MIN} to ${ISSUE_MAX} needed, got ${list.length}`);
  const measured = new Set(Object.keys(vars).filter((k) => vars[k] != null && String(vars[k]).trim() !== ''));
  const issues = [];
  const seen = new Set();
  for (const [i, x] of list.entries()) {
    const at = `issue ${i + 1}${x?.slug ? ` (${x.slug})` : ''}`;
    const str = (v) => (typeof v === 'string' ? v.trim() : '');
    const paras = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
    const it = {
      slug: str(x?.slug), cat: str(x?.cat), audience: AUDIENCES.includes(x?.audience) ? x.audience : 'everyone',
      name: str(x?.name), subject: str(x?.subject), heading: str(x?.heading), body: paras(x?.body),
      button_label: str(x?.button_label), button_url: str(x?.button_url),
      en: { subject: str(x?.en?.subject), heading: str(x?.en?.heading), body: paras(x?.en?.body) },
    };
    if (x?.story) it.story = str(x.story);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+){0,6}$/.test(it.slug)) errors.push(`${at}: slug must be lowercase ASCII words joined by "-"`);
    if (seen.has(it.slug)) errors.push(`${at}: slug repeated`);
    seen.add(it.slug);
    if (!ISSUE_CATS.includes(it.cat)) errors.push(`${at}: cat must be one of ${ISSUE_CATS.join(', ')}`);
    if (it.story && !storySlugs.includes(it.story)) errors.push(`${at}: story must be the slug of one of this edition's stories`);
    if (it.story && it.cat !== 'story') errors.push(`${at}: an issue with a story has cat "story"`);
    if (!it.name.startsWith('Newsletter — ')) errors.push(`${at}: name must start with "Newsletter — "`);
    for (const [k, max] of [['subject', 100], ['heading', 90]]) { if (!it[k] || it[k].length > max) errors.push(`${at}: ${k} missing or longer than ${max}`); if (!it.en[k] || it.en[k].length > max) errors.push(`${at}: en.${k} missing or longer than ${max}`); }
    if (BUTTONS[it.button_label] !== it.button_url) errors.push(`${at}: button_label must be one of ${Object.keys(BUTTONS).map((b) => `"${b}"`).join(', ')} with its matching button_url`);
    // body: >> preheader, "Hola {{name}}, …", ≥1 stat with a number, …, the link back to the page last
    const b = it.body;
    if (b.length < 5 || b.length > 12) errors.push(`${at}: body needs 5 to 12 paragraphs`);
    if (!b[0]?.startsWith('>> ')) errors.push(`${at}: body[0] must be the preheader, starting with ">> "`);
    if (!/^Hola \{\{name\}\}[,:]/.test(b[1] || '')) errors.push(`${at}: body[1] must start with "Hola {{name}},"`);
    if (b[b.length - 1] !== `[[Leer el newsletter completo]]({{newsletter_url}}#${it.slug})`) errors.push(`${at}: the last body paragraph must be exactly [[Leer el newsletter completo]]({{newsletter_url}}#${it.slug})`);
    const stats = b.filter((p) => p.startsWith('!! '));
    if (!stats.length) errors.push(`${at}: at least one stat paragraph "!! {{nl_…}} … | text"`);
    for (const p of b) {
      if (p.startsWith('!! ') && !/^!!\s+[^|]*\{\{\s*(nl_[a-z0-9_]+|active_listings)\s*\}\}[^|]*\|\s*\S/.test(p)) errors.push(`${at}: a stat must be "!! <value with a {{nl_…}} number> | <text>"`);
      const btn = /^\[\[([^\]]+)\]\]\(([^)\s]+)\)$/.exec(p);
      if (btn && btn[1] !== 'Leer el newsletter completo' && !(btn[1] === 'Ver más historias' && btn[2] === '{{stories_url}}') && BUTTONS[btn[1]] !== btn[2]) errors.push(`${at}: inline button "${btn[1]}" must be one of the allowed labels with its matching link`);
      if (!btn && /\[\[|\]\]\(/.test(p)) errors.push(`${at}: a button must be a paragraph of its own: [[label]](url)`);
      if (/^Hola \{\{name\}\}/.test(p) && p !== b[1]) errors.push(`${at}: only one greeting`);
    }
    const enb = it.en.body;
    if (enb.length < 2) errors.push(`${at}: en.body needs at least 2 paragraphs`);
    if (enb.some((p) => p.startsWith('>>') || /^Hi \{\{name\}\}/.test(p) || /^\[\[/.test(p))) errors.push(`${at}: en.body has no preheader, no greeting and no buttons (the page only)`);
    if (stats.length && !enb.some((p) => p.startsWith('!! '))) errors.push(`${at}: en.body needs the stat(s) too`);
    // placeholders: known ones only; every number one measured this week
    const esVars = new Set(varsIn([it.subject, it.heading, ...b].join('\n')));
    const all = [it.subject, it.heading, ...b, it.en.subject, it.en.heading, ...enb].join('\n');
    for (const v of new Set(varsIn(all))) {
      if (!KNOWN_VARS.has(v)) errors.push(`${at}: unknown placeholder {{${v}}}`);
      else if (NUMBER_VARS.includes(v) && !measured.has(v)) errors.push(`${at}: {{${v}}} was not measured this week — use only: ${[...measured].join(', ') || 'none'}`);
    }
    for (const v of varsIn([it.en.subject, it.en.heading, ...enb].join('\n'))) if (NUMBER_VARS.includes(v) && !esVars.has(v)) errors.push(`${at}: en uses {{${v}}} but the Spanish text doesn't`);
    if (/\{\{\s*name\s*\}\}/.test([it.heading, it.en.heading, ...enb].join(' '))) errors.push(`${at}: {{name}} only in the subject and the greeting`);
    // no literal numbers where a measured one belongs; the content rules
    for (const [k, v] of [['subject', it.subject], ['heading', it.heading], ...b.map((p, n) => [`body[${n}]`, p]), ['en.subject', it.en.subject], ['en.heading', it.en.heading], ...enb.map((p, n) => [`en.body[${n}]`, p])]) {
      if (LITERAL_NUMBER.test(String(v).replace(PLACEHOLDER, ''))) errors.push(`${at} ${k}: no literal prices, percentages or big numbers — use the {{nl_…}} placeholders`);
      errors.push(...textProblems(v, { where: `${at} ${k}`, country }));
    }
    issues.push(it);
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)], issues };
}

// The whole edition, as stored. → { ok, errors, edition }
export function validateEdition({ issues, stories }, { country = 'py', vars = {}, used = usedBefore([]), week, date } = {}) {
  const s = validateStories(stories, { country, used });
  const i = validateIssues(issues, { country, vars, storySlugs: s.stories.map((x) => x.slug) });
  const errors = [...s.errors, ...i.errors];
  if (!/^\d{4}-W\d{2}$/.test(String(week || ''))) errors.push('edition: bad week');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) errors.push('edition: bad date');
  return { ok: errors.length === 0, errors, edition: { week, date, issues: i.issues, stories: s.stories } };
}

// Claude's answer text → the JSON object (structured outputs return pure JSON; tolerate a fence).
export function parseJson(text) {
  const t = String(text || '').trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(t); } catch { /* fall through */ }
  const m = /\{[\s\S]*\}/.exec(t);
  if (!m) throw new Error('no JSON in the answer');
  return JSON.parse(m[0]);
}

// ── prompts ──────────────────────────────────────────────────────────────────
const L = { type: 'object', properties: { es: { type: 'string' }, en: { type: 'string' } }, required: ['es', 'en'], additionalProperties: false };
export const STORIES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['stories'],
  properties: { stories: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['slug', ...Object.keys(STORY_FIELDS)], properties: { slug: { type: 'string' }, ...Object.fromEntries(Object.keys(STORY_FIELDS).map((k) => [k, L])) } } } },
};
const paras = { type: 'array', items: { type: 'string' } };
export const ISSUES_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['issues'],
  properties: { issues: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['slug', 'cat', 'audience', 'story', 'name', 'subject', 'heading', 'body', 'button_label', 'button_url', 'en'],
    properties: {
      slug: { type: 'string' }, cat: { type: 'string', enum: ISSUE_CATS }, audience: { type: 'string', enum: AUDIENCES },
      story: { type: 'string', description: 'slug of one of the stories, or "" for none' },
      name: { type: 'string' }, subject: { type: 'string' }, heading: { type: 'string' }, body: paras,
      button_label: { type: 'string', enum: Object.keys(BUTTONS) }, button_url: { type: 'string', enum: [...new Set(Object.values(BUTTONS))] },
      en: { type: 'object', additionalProperties: false, required: ['subject', 'heading', 'body'], properties: { subject: { type: 'string' }, heading: { type: 'string' }, body: paras } },
    } } } },
};

export const SYSTEM = `You write the weekly newsletter of Casa-Libre, a property marketplace (houses, apartments, land, commercial places for sale and rent). Buyers and tenants write to the seller directly on WhatsApp; no exclusivity; on the web and in the Casa-Libre app for iPhone and Android. Positioning: US real-estate technology and experience, built for each country.
Voice: warm, concrete, short sentences, Spanish with "vos" (tenés, publicá, escribinos) exactly like the examples; English fields are natural English.
HARD RULES — a single break rejects the whole edition:
- Never name or hint at ANY business other than Casa-Libre: no portal, website, app store brand, social network, agency or franchise brand, bank, developer or company name. Say "otros portales", "una inmobiliaria", "el banco" in general terms. WhatsApp, iPhone and Android are the only other names allowed.
- Write the brand exactly "Casa-Libre" (with the hyphen).
- Whenever the app is mentioned, say it is for iPhone and Android, in the same sentence.
- No emojis. No web addresses. No unsubscribe / opt-out / "BAJA" line.
- Never "la mejor", "el mejor", "de mayor crecimiento", "gratis para siempre".
Return only the JSON the schema asks for.`;

const varLines = (vars) => NUMBER_VARS.filter((k) => vars[k] != null && String(vars[k]).trim() !== '').map((k) => `{{${k}}} = ${vars[k]}`).join('\n') || '(none measured this week)';

export function storiesPrompt({ country = 'py', vars = {}, used = usedBefore([]), date }) {
  const f = COUNTRY_FACTS[country] || COUNTRY_FACTS.py;
  return `Write this week's ${STORY_COUNT} NEW success stories for the Casa-Libre newsletter in ${f.name} (edition of ${date}).
They are illustrative stories (first names only, no surnames, no real people or companies), in exactly the same shape, length and tone as these examples:
${JSON.stringify(EXAMPLE_STORIES)}

Requirements:
- Exactly ${STORY_COUNT} stories. Mix: at least 3 owners ("<Nombre> · dueña de una casa"), at least 3 independent agents ("<Nombre> · agente"), at least 2 agencies or developers ("<Nombre> · inmobiliaria de 4 personas"), and buyers / tenants / investors are welcome too.
- Spread them over at least 6 different cities of ${f.name}, chosen from: ${f.cities.join(', ')}. Put the city in "when" ("en <ciudad>") or in the title.
- Vary property types (casa, departamento, dúplex, terreno, local comercial, oficina, depósito, quinta, monoambiente…) and operations (venta, alquiler). Each story has its own problem and its own concrete numbers (days, enquiries, viewings) — realistic, modest, never a commission or a price claim about Casa-Libre.
- What they did is always something they can do on Casa-Libre: daylight photos, the price in plain sight, the exact spot on the map, a complete profile with their photo and name, answering WhatsApp fast, publishing from the app for iPhone and Android, sending CARTERA by WhatsApp to upload a whole portfolio.
- slug: ASCII, lowercase, "<firstname>-<what>-<place>" (e.g. "nadia-depto-lambare"), starting with the first name without accents.
- First names: new ones only. NEVER use any of these (already used): ${[...used.names].join(', ')}.
- Slugs never used before: ${[...used.slugs].slice(-150).join(', ')}.
- "who.en" starts with the same first name. "quote" without quotation marks.
- This week buyers on Casa-Libre looked at (use it for ideas, do not quote the numbers): ${varLines(vars).replace(/\n/g, '; ')}.`;
}

export function issuesPrompt({ country = 'py', vars = {}, stories = [], date }) {
  const f = COUNTRY_FACTS[country] || COUNTRY_FACTS.py;
  return `Write this week's newsletter articles ("issues") for Casa-Libre in ${f.name} (edition of ${date}): ${ISSUE_MIN} or ${ISSUE_MAX} articles, in exactly the same structure as these examples (body = one string per paragraph):
${JSON.stringify(EXAMPLE_ISSUES)}

The numbers measured this week (the website fills the placeholders with the real values on the page and in the email):
${varLines(vars)}

Rules:
- NEVER write a number of the measurement yourself: use the placeholders above, and ONLY those listed (any other {{nl_…}} was not measured this week). Small counting words in tips are fine ("3 fotos", "2 minutos"); prices, percentages and totals never.
- The first article is about what buyers look for / search this week (data). Pick fresh angles from the numbers above; don't copy the example titles.
- One article may tell one of this week's stories: set "story" to its slug and cat "story", write the article around it (the website adds the story card, so don't repeat the story text) and put "[[Ver más historias]]({{stories_url}})" just before the last paragraph. Otherwise "story" is "".
- body (Spanish, the email + the page): body[0] the preheader starting with ">> "; body[1] starts with "Hola {{name}}, "; at least one stat paragraph "!! <value with a placeholder> | <text>"; "## " for small headings; optional buttons as their own paragraph "[[<label>]](<url>)" with only these labels/urls: ${Object.entries(BUTTONS).map(([k, v]) => `[[${k}]](${v})`).join(' ')}; the LAST paragraph exactly "[[Leer el newsletter completo]]({{newsletter_url}}#<slug>)".
- en: subject, heading and body in English for the page only: no preheader, no greeting, no buttons, no newsletter link; the same stats and headings.
- name: "Newsletter — <short Spanish label>". audience: everyone | sellers | buyers | never_listed. cat: ${ISSUE_CATS.join(' | ')}.
- slug: ASCII lowercase words joined by "-", unique.
This week's stories: ${JSON.stringify(stories.map((s) => ({ slug: s.slug, who: s.who.es, title: s.title.es, metric: s.metric.es })))}`;
}

export const repairPrompt = (errors) => `Your JSON broke these rules — fix every one and return the whole corrected JSON again (same schema):\n- ${errors.slice(0, 40).join('\n- ')}`;

// The admin card's "last edition" line from a stored row.
export function editionSummary(row) {
  if (!row) return null;
  return {
    id: row.id, week: row.week, date: row.date, status: row.status, created_at: row.created_at, error: row.error || null, model: row.model || null,
    issues: (Array.isArray(row.issues) ? row.issues : []).map((i) => i.subject),
    stories: (Array.isArray(row.stories) ? row.stories : []).map((s) => s.title?.es),
  };
}
