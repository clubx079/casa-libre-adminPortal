// Google Trends "trending now" RSS (https://trends.google.com/trending/rss?geo=PY) — parser and topic
// tagger (pure — test/seoTrends.test.js). The collector (lib/seo/collect.js) fetches it hourly per country.
export const TREND_GEOS = { py: 'PY', bo: 'BO', uy: 'UY', ve: 'VE', sv: 'SV' };

const decode = (s) => String(s || '')
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n)))
  .replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`).exec(xml); return m ? decode(m[1]) : ''; };

// "200+" → 200, "2K+" / "2 mil+" → 2000, "1M+" → 1000000
export function parseTraffic(label) {
  const m = /([\d.,]+)\s*(mill[oó]n(?:es)?|mil|k|m)?/i.exec(String(label || ''));
  if (!m) return null;
  let n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  const u = (m[2] || '').toLowerCase();
  if (u === 'k' || u === 'mil') n *= 1000;
  else if (u === 'm' || u.startsWith('mill')) n *= 1000000;
  return Math.round(n);
}

export function parseTrendsRss(xml) {
  const items = [];
  for (const m of String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const it = m[1];
    const title = tag(it, 'title');
    if (!title) continue;
    const trafficLabel = tag(it, 'ht:approx_traffic');
    const news = [...it.matchAll(/<ht:news_item>([\s\S]*?)<\/ht:news_item>/g)].map((n) => ({
      title: tag(n[1], 'ht:news_item_title'), url: tag(n[1], 'ht:news_item_url'), source: tag(n[1], 'ht:news_item_source'),
    })).filter((n) => n.title);
    const pd = tag(it, 'pubDate');
    const t = Date.parse(pd);
    items.push({ title, trafficLabel: trafficLabel || null, traffic: parseTraffic(trafficLabel), pubDate: Number.isFinite(t) ? new Date(t).toISOString() : null, news });
  }
  return items;
}

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const PROPERTY = /\b(inmobiliari[oa]s?|inmuebles?|viviendas?|casas? propias?|departamentos?|alquiler(es)?|alquilar|hipotecas?|creditos? hipotecarios?|mi vivienda|che roga|muvh|senavitat|construccion|constructoras?|terrenos?|loteamientos?|catastro|impuesto inmobiliario|escrituras?|bienes raices|real estate|condominio|edificios?|mercado inmobiliario|precio del m2|desalojo|inquilinos?|vivienda social|plan de vivienda|aluguel|imoveis?)\b/;
const ECONOMY = /\b(dolar|dolares|cotizacion|tipo de cambio|inflacion|tasa de interes|tasas?|banco central|bcp|bcb|bcu|bcv|salario minimo|aguinaldo|impuestos?|iva|ips|set|dnit|economia|pib|recesion|bolsa|precio del combustible|combustible|nafta|gasoil|petropar|ande|tarifa|devaluacion|bitcoin|cripto|creditos?|prestamos?|bonos?|deuda|presupuesto|jubilacion|pension|subsidio|feriado bancario|bolivar|bolivares|euro|guaranies?|bolivianos?)\b/;

// → 'property' | 'economy' | 'other'. A keyword in the trend's own title counts double; the news
// headlines need two DIFFERENT keywords ("allanan viviendas" alone is a police story, not housing).
const stem = (w) => w.replace(/(es|s)$/, '');
function hits(re, text) {
  const g = new RegExp(re.source, 'g');
  return new Set([...text.matchAll(g)].map((m) => stem(m[0])));
}
export function topicOf(title, newsTitles = []) {
  const t = fold(title);
  const n = fold(newsTitles.join(' · '));
  for (const [topic, re] of [['property', PROPERTY], ['economy', ECONOMY]]) {
    const inTitle = hits(re, t).size;
    const inNews = hits(re, n);
    if (inTitle * 2 + inNews.size >= 2) return topic;
  }
  return 'other';
}

export const seenHour = (d = new Date()) => d.toISOString().slice(0, 13);
