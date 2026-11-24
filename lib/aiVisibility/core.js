// AI visibility → AI SEO — the pure part (test/aiVisibility.test.js).
// Every day the admin asks AI assistants (ChatGPT, Gemini, Claude, Perplexity, Grok — whichever have
// an API key — plus Google AI answers through the Grok bot) the questions buyers and owners ask, and
// records whether Casa-Libre is named and which competitors are. A question where competitors are
// named and Casa-Libre isn't is a GAP: it goes to the AI SEO pipeline as a keyword (source
// 'ai_visibility'), which writes an answer page for it. The rules below keep that clean:
//   · never a keyword that names a competitor (we only work keywords that help Casa-Libre)
//   · never a competitor's name or an outside link on any page we publish (findForbidden)

// Brands that must never appear on our pages and never become our keywords:
// [canonical name, pattern on folded text (lowercase, no accents)].
const BRAND_PATTERNS = [
  ['InfoCasas', 'info ?casas'], ['Clasipar', 'clasipar'], ['Century 21', 'century ?21|c21'], ['RE/MAX', 're ?/? ?max'],
  ['Habitamia', 'habitamia'], ['Facebook Marketplace', 'facebook marketplace|marketplace de facebook|marketplace'],
  ['Mercado Libre', 'mercado ?libre'], ['Zonaprop', 'zona ?prop'], ['Argenprop', 'argenprop'], ['Inmuebles24', 'inmuebles ?24'],
  ['Properati', 'properati'], ['Idealista', 'idealista'], ['Fotocasa', 'fotocasa'], ['Encuentra24', 'encuentra ?24'],
  ['Trovit', 'trovit'], ['Mitula', 'mitula'], ['Lamudi', 'lamudi'], ['UltraCasas', 'ultra ?casas'], ['Gallito', 'gallito'],
  ['OLX', 'olx'], ['Toctoc', 'toc ?toc'], ['Fincaraiz', 'finca ?raiz'], ['Propimundo', 'propimundo'], ['Tu Lugar', 'tu ?lugar\.com|tulugar'],
  ['Coldwell Banker', 'coldwell banker'], ['Keller Williams', 'keller williams'], ['Sotheby\'s', 'sotheby'], ['Nuroa', 'nuroa'], ['Doomos', 'doomos'],
  ['Buscocasita', 'busco ?casita'], ['Viviaza', 'viviaza'], ['Nderoga', 'nderoga'], ['Wasi', 'wasi\.co|wasi'], ['Tiendli', 'tiendli'],
  // Paraguay agencies (Wasi customers list, Nov 2026) — named businesses, never ours to mention or target
  ['Ganesha', 'ganesha'], ['NIP', 'nip inmobiliaria|negocios inmobiliarios del paraguay'], ['Terrés', 'terres inmobiliaria|inmobiliaria terres'],
  ['Künzle', 'kunzle'], ['Plusterra', 'plusterra'], ['Realtyplus', 'realty ?plus'], ['Propisur', 'propisur'], ['Rasmussen', 'rasmussen'],
  ['AltaCasa', 'alta ?casa'], ['Constructierra', 'constructierra'], ['Christa Cortázar', 'christa cortazar'], ['Carmen Estaque', 'carmen estaque'],
  ['Aló Propiedades', 'alo propiedades'], ['J.Porta', 'j\\.? ?porta negocios'], ['Assets Real Estate', 'assets real estate|assets paraguay'],
  ['Pirámide', 'inmobiliaria piramide'], ['Home & Investments', 'home (?:&|and|y) investments'], ['Rural Real Estate', 'rural real estate'],
];
export const COMPETITORS = BRAND_PATTERNS.map(([name]) => name);
export const fold = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const BRAND_RES = BRAND_PATTERNS.map(([name, pat]) => [name, new RegExp(`(^|[^a-z0-9])(${pat})(?=$|[^a-z0-9])`)]);
const US_RE = /casa[\s-]?libre/;
const OUR_HOSTS = /(^|\.)casa-libre\.(com|com\.py|com\.bo|com\.ve)$|(^|\.)casalibre\./;

// Which competitor names appear in a text (canonical names, in order of first appearance).
export function competitorsIn(text) {
  const t = fold(text);
  return BRAND_RES.map(([name, re]) => { const m = re.exec(t); return m ? [name, m.index] : null; })
    .filter(Boolean).sort((a, b) => a[1] - b[1]).map(([name]) => name);
}
const firstIndex = (text, name) => { const re = BRAND_RES.find(([n]) => n === name)?.[1]; const m = re ? re.exec(fold(text)) : null; return m ? m.index : -1; };
// Any other business: a known brand / agency, or a web address (www.…, ….com, ….com.py …) in the words.
const DOMAIN_IN_TEXT = /\b(?:www\.)?[a-z0-9-]{2,}\.(?:com|net|org|com\.py|py|com\.bo|bo|com\.uy|uy|com\.ve|ve|com\.sv|sv|online|app|io)\b/;
const OURS_IN_TEXT = /casa-?libre\.|casalibre\./;
export const namesCompetitor = (text) => competitorsIn(text).length > 0 || (DOMAIN_IN_TEXT.test(fold(text)) && !OURS_IN_TEXT.test(fold(text)));
export const mentionsUs = (text) => US_RE.test(fold(text));

// One answer → what it says about us and the others.
//   position = our place among the brands it names (1 = first), null when we're not named
export function analyzeAnswer(text, citations = []) {
  const t = String(text || '');
  const comps = competitorsIn(t);
  const ours = mentionsUs(t);
  let position = null;
  if (ours) {
    const at = fold(t).search(US_RE);
    position = 1 + comps.filter((c) => { const i = firstIndex(t, c); return i >= 0 && i < at; }).length;
  }
  const sources = [...new Set((citations || []).map((u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } }).filter(Boolean))].slice(0, 20);
  const quote = ours ? (t.split(/(?<=[.!?\n])\s+/).find((s) => mentionsUs(s)) || '').slice(0, 300) : null;
  return { mentioned: ours, position, competitors: comps, sources, quote };
}

// The country a question is about (default Paraguay).
export function countryOf(q) {
  const t = fold(q);
  if (/bolivia|santa cruz de la sierra|cochabamba|la paz\b/.test(t)) return 'bo';
  if (/uruguay|montevideo|punta del este/.test(t)) return 'uy';
  if (/venezuela|caracas|maracaibo|valencia\b/.test(t)) return 've';
  if (/el salvador|san salvador/.test(t)) return 'sv';
  return 'py';
}
export const languageOf = (q) => (/\b(the|best|where|how|to|my|in|a)\b/i.test(q) && !/[áéíóúñ¿]|\b(el|la|los|de|en|para|mi|como|donde)\b/i.test(q) ? 'en' : 'es');

// A question → the search keyword we'd work (folded, no punctuation). null = never ours to work:
// it names a competitor, or it isn't in Spanish (our pages are Spanish).
export function keywordOf(question) {
  if (namesCompetitor(question)) return null;
  if (languageOf(question) !== 'es') return null;
  const k = fold(question).replace(/[¿?¡!.,;:"'()]/g, ' ').replace(/\s+/g, ' ').trim();
  return k.length >= 8 && k.length <= 120 ? k : null;
}

// Answers of the last days → one row per question: how often we / competitors are named.
//   gap = competitors named in ≥ half of the answers and Casa-Libre in under a third (≥2 answers)
export function questionStats(answers = [], { minAnswers = 2, compShare = 0.5, ourShare = 1 / 3 } = {}) {
  const by = new Map();
  for (const a of answers) {
    if (a.error || !a.question) continue;
    const k = a.question.trim();
    const s = by.get(k) || { question: k, country: a.country || countryOf(k), answers: 0, ours: 0, withCompetitors: 0, competitors: {}, assistants: {}, sources: {}, positions: [] };
    s.answers += 1;
    if (a.mentioned) { s.ours += 1; if (a.position) s.positions.push(a.position); }
    if ((a.competitors || []).length) s.withCompetitors += 1;
    for (const c of a.competitors || []) s.competitors[c] = (s.competitors[c] || 0) + 1;
    const as = s.assistants[a.assistant] || { answers: 0, ours: 0 };
    as.answers += 1; if (a.mentioned) as.ours += 1;
    s.assistants[a.assistant] = as;
    for (const h of a.sources || []) s.sources[h] = (s.sources[h] || 0) + 1;
    by.set(k, s);
  }
  return [...by.values()].map((s) => {
    const ourRate = s.answers ? s.ours / s.answers : 0;
    const compRate = s.answers ? s.withCompetitors / s.answers : 0;
    const keyword = keywordOf(s.question);
    return {
      ...s,
      ourRate: Math.round(ourRate * 100) / 100,
      compRate: Math.round(compRate * 100) / 100,
      topCompetitors: Object.entries(s.competitors).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, n]) => ({ name, n })),
      topSources: Object.entries(s.sources).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([host, n]) => ({ host, n })),
      avgPosition: s.positions.length ? Math.round((s.positions.reduce((x, y) => x + y, 0) / s.positions.length) * 10) / 10 : null,
      keyword,
      gap: s.answers >= minAnswers && compRate >= compShare && ourRate < ourShare,
    };
  }).sort((a, b) => Number(b.gap) - Number(a.gap) || b.compRate - a.compRate);
}

// Gap questions → SEO pipeline signals (source 'ai_visibility', merged in at Decide; not stored in
// seo_signals). Only questions whose keyword we may work (keywordOf) and of this country.
export function toSignals(stats = [], cc, date) {
  return stats.filter((s) => s.gap && s.keyword && s.country === cc).map((s) => ({
    country: cc, source: 'ai_visibility', term: s.keyword, page: '', date,
    metrics: {
      question: s.question, answers: s.answers, our_rate: s.ourRate, competitor_rate: s.compRate,
      competitors: s.topCompetitors.map((c) => c.name), assistants: Object.keys(s.assistants), gap: true,
    },
  }));
}

// Text we are about to publish → what breaks the rules: competitor names and links to other sites.
export function findForbidden(text) {
  const t = String(text || '');
  const problems = competitorsIn(t).map((c) => `names a competitor: ${c}`);
  for (const m of t.matchAll(/\b(?:https?:\/\/|www\.)([a-z0-9.-]+\.[a-z]{2,})/gi)) {
    const host = m[1].toLowerCase().replace(/^www\./, '');
    if (!OUR_HOSTS.test(host)) problems.push(`links to another site: ${host}`);
  }
  return [...new Set(problems)];
}
// Every text field of a guide draft, joined (title, h1, description, answer, sections, faq).
export const draftText = (d = {}) => [d.title, d.h1, d.description, d.answer,
  ...(d.sections || []).flatMap((s) => [s.h2, ...(s.paras || [])]),
  ...(d.faq || []).flatMap((f) => [f.q, f.a])].filter(Boolean).join('\n');
