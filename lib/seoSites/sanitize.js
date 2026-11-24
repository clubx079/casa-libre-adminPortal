// AI SEO for the sites — cleaning what Claude (or a person) writes before it is saved (pure —
// test/seoSites.test.js). The sites clean it again when they render it.
//   sanitizeHtml(html)    only <a href>, <strong>, <em> survive; links only to the site's own pages
//                         ('/…') or to Casa-Libre; everything else becomes plain, escaped text
//   plainText(s)          tags removed, entities kept escaped-safe
//   cleanGuide(obj, site, { cc, slug, today })   → the SITE guide object (spec format) or throws
//   namesCompetitor(guide)   true when the copy names another portal / website (never allowed)
import { SLUG_RE, slugify } from './scope.js';
import { namesCompetitor as namesRival } from '../aiVisibility/core.js';

const CL_HOST = /^(?:www\.)?(?:casa-libre\.com\.(?:py|bo|ve)|(?:uy|sv)\.casa-libre\.com)$/i;
const esc = (s) => String(s).replace(/&(?!(?:[a-z]+|#\d+|#x[0-9a-f]+);)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const unesc = (s) => String(s).replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function safeHref(href) {
  const h = unesc(String(href || '').trim());
  if (/^\/(?!\/)[a-z0-9\-/#?=&_.%]*$/i.test(h)) return h;   // the site's own page
  try {
    const u = new URL(h);
    if (u.protocol === 'https:' && CL_HOST.test(u.hostname)) return u.toString();
  } catch { /* not a URL */ }
  return null;
}

const TAG = /<\s*(\/?)\s*([a-z0-9]+)([^>]*)>/gi;
export function sanitizeHtml(html) {
  const src = String(html ?? '');
  let out = '';
  let last = 0;
  const open = [];   // stack of tags we kept
  for (const m of src.matchAll(TAG)) {
    out += esc(src.slice(last, m.index));
    last = m.index + m[0].length;
    const closing = !!m[1];
    const name = m[2].toLowerCase();
    if (name === 'b' || name === 'strong' || name === 'i' || name === 'em') {
      const tag = name === 'b' ? 'strong' : name === 'i' ? 'em' : name;
      if (!closing) { out += `<${tag}>`; open.push(tag); }
      else { const at = open.lastIndexOf(tag); if (at >= 0) { open.splice(at, 1); out += `</${tag}>`; } }
    } else if (name === 'a') {
      if (!closing) {
        const hm = /href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(m[3] || '');
        const href = hm ? safeHref(hm[2] ?? hm[3] ?? hm[4]) : null;
        if (href) { out += `<a href="${esc(href)}">`; open.push('a'); } else open.push('a-dropped');
      } else {
        const at = Math.max(open.lastIndexOf('a'), open.lastIndexOf('a-dropped'));
        if (at >= 0) { if (open[at] === 'a') out += '</a>'; open.splice(at, 1); }
      }
    }
    // any other tag: dropped (its text stays)
  }
  out += esc(src.slice(last));
  // close what was left open
  for (let i = open.length - 1; i >= 0; i -= 1) if (open[i] !== 'a-dropped') out += `</${open[i]}>`;
  return out.replace(/\s+/g, ' ').trim();
}

export const plainText = (s) => esc(unesc(String(s ?? '').replace(/<[^>]*>/g, ''))).replace(/\s+/g, ' ').trim();
const cut = (s, n) => { const t = plainText(s); return t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`; };
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

/** → the site guide object of the spec, every field cleaned. Throws when the guide is unusable. */
export function cleanGuide(raw, site, { cc, slug, today = new Date().toISOString().slice(0, 10) } = {}) {
  const g = raw || {};
  const country = cc || g.cc || site.rootCountry;
  const s = String(slug || g.slug || slugify(g.title || '')).toLowerCase();
  if (!SLUG_RE.test(s)) throw new Error(`bad slug "${s}"`);
  const title = cut(g.title, 70);
  const h1 = cut(g.h1 || g.title, 140);
  if (title.length < 10 || !h1) throw new Error('title / H1 missing');
  const ids = new Set();
  const sections = (Array.isArray(g.sections) ? g.sections : []).slice(0, 8).map((sec, i) => {
    let id = slugify(sec?.id || sec?.h2 || `seccion-${i + 1}`) || `seccion-${i + 1}`;
    while (ids.has(id)) id = `${id}-${i + 1}`;
    ids.add(id);
    const blocks = (Array.isArray(sec?.blocks) ? sec.blocks : Array.isArray(sec?.paras) ? sec.paras.map((p) => ({ t: 'p', html: p })) : [])
      .map((b) => {
        if (b?.t === 'ul' && Array.isArray(b.items)) { const items = b.items.map(sanitizeHtml).filter(Boolean).slice(0, 12); return items.length ? { t: 'ul', items } : null; }
        const html = sanitizeHtml(b?.html ?? b?.text ?? (typeof b === 'string' ? b : ''));
        return html ? { t: 'p', html } : null;
      }).filter(Boolean);
    return { id, h2: cut(sec?.h2, 140), blocks };
  }).filter((x) => x.h2 && x.blocks.length);
  if (!sections.length) throw new Error('no usable section');
  const faq = (Array.isArray(g.faq) ? g.faq : []).map((f) => ({ q: cut(f?.q, 200), a: plainText(f?.a) })).filter((f) => f.q && f.a).slice(0, 8);
  const summary = (Array.isArray(g.summary) ? g.summary : []).map((x) => plainText(x)).filter(Boolean).slice(0, 6);
  return {
    cc: country, slug: s, title, h1,
    description: cut(g.description || g.answer || title, 160),
    navLabel: cut(g.navLabel || title, 60), blurb: cut(g.blurb || g.description || '', 220),
    published: isDate(g.published) ? g.published : today, updated: isDate(g.updated) ? g.updated : today,
    answer: sanitizeHtml(g.answer || ''), summary, sections, faq, source: 'pipeline',
  };
}

/** Every visible string of a guide in one text (for the checks below). */
export const guideText = (g) => [g.title, g.h1, g.description, g.navLabel, g.blurb, g.answer, ...(g.summary || []),
  ...(g.sections || []).flatMap((s) => [s.h2, ...(s.blocks || []).flatMap((b) => (b.t === 'ul' ? b.items : [b.html]))]),
  ...(g.faq || []).flatMap((f) => [f.q, f.a])].join(' \n ');

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// Other portals / agencies / classifieds (social networks and Google may be named: "compartí en Instagram").
export const COMPETITORS = /(^|[^a-z0-9])(?:infocasas|clasipar|inmuebles24|zonaprop|mercado ?libre|olx|properati|argenprop|remax|re\/?max|century ?21|coldwell|keller williams|idealista|encuentra24|ultracasas|hogaru|tucasa|vivanuncios|lamudi|trovit|fincaraiz|toctoc|airbnb|booking)(?=$|[^a-z0-9])/;
export function namesCompetitor(g) {
  const t = fold(guideText(g).replace(/<a [^>]*>/g, ' '));
  return COMPETITORS.test(t) || namesRival(t);   // + the shared list (Habitamia, Facebook Marketplace, local portals…)
}

/** Does the guide link to Casa-Libre at least once? */
export const linksCasaLibre = (g) => /href="https:\/\/(?:www\.)?(?:casa-libre\.com\.(?:py|bo|ve)|(?:uy|sv)\.casa-libre\.com)/.test(guideText(g));

