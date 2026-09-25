// Spanish → English translation for the template editor's "Preview in English".
// Preview only: nothing is saved and emails are still sent in Spanish.
// {{variables}} and link addresses are swapped for tokens before translating and put
// back after, so they survive untouched. MyMemory first (free; the contact address
// raises its daily quota), Google's public endpoint as a fallback.

export function mask(text) {
  const keep = [];
  const masked = String(text ?? '').replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}|https?:\/\/[^\s)]+/g, (m) => { keep.push(m); return `__V${keep.length - 1}__`; });
  return { masked, keep };
}

export function unmask(text, keep) {
  return String(text ?? '').replace(/__\s*V\s*(\d+)\s*__/gi, (m, i) => (keep[Number(i)] ?? m));
}

async function viaMyMemory(text) {
  const url = `https://api.mymemory.translated.net/get?langpair=es|en&de=omar@airosofts.com&q=${encodeURIComponent(text)}`;
  const j = await fetch(url, { cache: 'no-store' }).then((r) => r.json());
  if (Number(j?.responseStatus) !== 200 || !j?.responseData?.translatedText) throw new Error(j?.responseDetails || 'mymemory_failed');
  return j.responseData.translatedText;
}

async function viaGoogle(text) {
  const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=es&tl=en&dt=t&q=${encodeURIComponent(text)}`;
  const t = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, cache: 'no-store' }).then((r) => r.text());
  const j = JSON.parse(t);
  return j[0].map((x) => x[0]).join('');
}

export async function translateToEnglish(text) {
  if (!String(text || '').trim()) return text || '';
  const { masked, keep } = mask(text);
  let out;
  try { out = await viaMyMemory(masked); } catch { out = await viaGoogle(masked); }
  return unmask(out, keep);
}
