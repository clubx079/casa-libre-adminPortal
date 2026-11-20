// Translate the visible text of an HTML email, keeping its design, links and images exactly as
// they are (Email & WhatsApp campaigns → preview, "English"). Pure — test/htmlTranslate.test.js.
// The text between tags is pulled out, translated in one batch (translateMany: string[] →
// (string|null)[], lib/translate.js translateManyToEnglish), and put back; <style>, <script>,
// <head> and comments are left alone. A piece that fails to translate stays in Spanish.

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', uuml: 'ü', iexcl: '¡', iquest: '¿', middot: '·', hellip: '…', mdash: '—', ndash: '–', laquo: '«', raquo: '»', copy: '©', reg: '®' };
export const decode = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e] ?? m;
});
export const encode = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Worth translating: has a letter, and is not just a link, an email address or a number.
const worth = (t) => /\p{L}{3,}/u.test(t) && !/^\s*(https?:\/\/\S+|\S+@\S+\.\S+)\s*$/.test(t);

// → { parts, jobs: [{ i, lead, text, trail }] } — parts = the html cut into tags and texts
export function splitHtml(html) {
  const parts = [];
  const re = /(<!--[\s\S]*?-->|<(style|script|head|title)\b[\s\S]*?<\/\2\s*>|<[^>]+>)/gi;
  let last = 0; let m;
  while ((m = re.exec(html))) {
    if (m.index > last) parts.push({ text: html.slice(last, m.index) });
    parts.push({ tag: m[0] });
    last = m.index + m[0].length;
  }
  if (last < html.length) parts.push({ text: html.slice(last) });
  const jobs = [];
  parts.forEach((p, i) => {
    if (p.text == null) return;
    const raw = decode(p.text);
    const lead = raw.match(/^\s*/)[0]; const trail = raw.match(/\s*$/)[0];
    const text = raw.trim();
    if (text && worth(text)) jobs.push({ i, lead, text, trail });
  });
  return { parts, jobs };
}

// The brand must never be translated ("Casa Libre" → "Free house"): it travels as a {{variable}},
// which lib/translate.js keeps untouched, and comes back as written.
const BRAND = /casa[\s-]?libre(\.com)?(\.[a-z]{2})?/gi;
const hideBrand = (t) => { const kept = []; return { text: t.replace(BRAND, (m) => { kept.push(m); return `{{cl${kept.length - 1}}}`; }), kept }; };
const showBrand = (t, kept) => String(t).replace(/\{\{\s*cl(\d+)\s*\}\}/g, (m, i) => kept[Number(i)] ?? m);

export async function translateHtml(html, translateMany) {
  const { parts, jobs } = splitHtml(String(html || ''));
  if (!jobs.length) return { html, translated: 0 };
  const hidden = jobs.map((j) => hideBrand(j.text));
  // a piece that is only the brand is not sent at all
  const out = await translateMany(hidden.map((h) => (/^(\{\{cl\d+\}\}[\s.]*)+$/.test(h.text) ? '' : h.text)));
  let n = 0;
  jobs.forEach((j, k) => {
    const t = out?.[k] ? showBrand(out[k], hidden[k].kept) : null;
    if (!t) return;
    parts[j.i] = { text: encode(`${j.lead}${t}${j.trail}`) };
    n += 1;
  });
  return { html: parts.map((p) => (p.tag != null ? p.tag : p.text)).join(''), translated: n, total: jobs.length };
}
