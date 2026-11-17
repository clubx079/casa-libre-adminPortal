// Stage 4 — the fallback guide draft: a deterministic Spanish article built from the data (pure —
// test/seoDraft.test.js). Used when Claude is unavailable (no key / no credit / error) and as the
// starting point Claude improves on. Numbers are PLACEHOLDERS the website fills from live listings at
// render time (refreshed monthly): {{count:/path}} {{median:/path}} {{min:/path}} {{max:/path}}
// {{range:/path}} {{newest:/path}} {{month}} — so an approved guide never goes stale.
import { OPS, TIPOS, pathOf } from './matrix.js';
import { termKey } from './matcher.js';

export const slugForTerm = (term) => termKey(term).replace(/ /g, '-').slice(0, 70);
const cap = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
const FEM = new Set(['casas', 'oficinas']);   // una casa / una oficina; the rest are masculine
const ACCENTS = { cuanto: 'cuánto', cuanta: 'cuánta', cuantos: 'cuántos', cuantas: 'cuántas', como: 'cómo', donde: 'dónde', cual: 'cuál', cuales: 'cuáles', cuando: 'cuándo', que: 'qué' };
const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// "cuanto cuesta una casa en paraguay" → "¿Cuánto cuesta una casa en Paraguay?" (question words get their
// accent when they open the question; country and city names their proper spelling)
export function prettyQuestion(term, names = []) {
  let words = String(term || '').replace(/[¿?]/g, '').replace(/\s+/g, ' ').trim().split(' ');
  if (words[0] && ACCENTS[fold(words[0])]) words[0] = ACCENTS[fold(words[0])];
  let q = words.join(' ');
  for (const n of names.filter(Boolean).sort((a, b) => b.length - a.length)) {
    const f = fold(n);
    const i = fold(q).indexOf(f);
    if (i >= 0 && (i === 0 || fold(q)[i - 1] === ' ')) q = q.slice(0, i) + n + q.slice(i + n.length);
  }
  return `¿${cap(q)}?`;
}

// ctx: { term, kind: 'guide'|'trend_post', parsed, countryName, cityName, capitalSlug, capitalName, news: [{title, source, url}], stats }
export function templateDraft(ctx) {
  const { term, kind = 'guide', parsed = {}, countryName = 'Paraguay' } = ctx;
  const slug = parsed.slug || slugForTerm(term);
  const op = parsed.op && OPS[parsed.op] ? parsed.op : null;
  const tipo = parsed.tipo && TIPOS[parsed.tipo] ? parsed.tipo : null;
  // no city in the search ("¿cuánto cuesta una casa en Paraguay?") → numbers for the whole country
  const ciudad = parsed.ciudad || null;
  const cityName = parsed.ciudad ? (ctx.cityName || ctx.capitalName || countryName) : countryName;
  if (kind === 'trend_post') return trendDraft({ ...ctx, slug, cityName });

  // "¿cuánto cuesta un departamento?" with no buy/rent word reads as buying
  const useOp = op || 'venta';
  const useTipo = tipo || 'departamentos';
  const path = ciudad ? pathOf({ op: useOp, tipo: useTipo, ciudad }) : (tipo ? `/${useOp}/${useTipo}` : null);
  const t = TIPOS[useTipo];
  const o = OPS[useOp];
  const verb = useOp === 'alquiler' ? 'alquilar' : 'comprar';
  const periodo = useOp === 'alquiler' ? ' por mes' : '';
  const question = prettyQuestion(term, [countryName, cityName, ...(ctx.cityNames || [])]);
  const h1 = question.replace(/^¿|\?$/g, '');
  const un = FEM.has(useTipo) ? 'una' : 'un';
  const pub = FEM.has(useTipo) ? 'publicadas' : 'publicados';
  const ph = (k) => (path ? `{{${k}:${path}}}` : '');

  const answer = path
    ? `Hoy, en Casa Libre, ${verb} ${un} ${t.sing} en ${cityName} cuesta alrededor de ${ph('median')}${periodo} (precio típico de ${ph('count')} ${t.plural} ${o.label} ${pub}). El rango va de ${ph('min')} a ${ph('max')}. Datos de ${'{{month}}'}, actualizados cada mes con las propiedades publicadas.`
    : `La respuesta depende de la zona y del tipo de propiedad. En Casa Libre podés ver los precios publicados hoy en ${countryName}, filtrar por barrio, precio y dormitorios, y contactar directo por WhatsApp.`;

  const sections = [
    { h2: `Precios de ${t.plural} ${o.label} en ${cityName}`, paras: path ? [
      `Con ${FEM.has(useTipo) ? 'las' : 'los'} ${ph('count')} ${t.plural} ${o.label} ${pub} en ${cityName}, el precio típico (la mediana) es ${ph('median')}${periodo}: la mitad de las opciones pide menos y la otra mitad, más.`,
      `El rango completo va de ${ph('min')} a ${ph('max')}. Los extremos suelen ser casos especiales — muy chicos, muy céntricos o con amenities — así que conviene mirar el medio del rango.`,
      `La publicación más reciente es del ${ph('newest')}. Estos números se actualizan solos cada mes con lo que está publicado.`,
    ] : [
      `Los precios cambian mucho entre barrios y tipos de propiedad. La forma más rápida de tener una referencia real es mirar lo publicado hoy y comparar opciones parecidas en el mapa.`,
    ] },
    { h2: 'Qué mueve el precio', paras: [
      'La ubicación es lo primero: cercanía a avenidas, comercios y transporte. Después pesan los metros cubiertos, la cantidad de dormitorios, la antigüedad y el estado, y si tiene cochera o amenities.',
      useOp === 'alquiler'
        ? 'En alquileres, revisá también qué incluye el precio: expensas, servicios y si el contrato pide garantía o depósito.'
        : 'En compras, el precio publicado es el que se pide, no el de cierre: suele haber margen para negociar, y la escritura y los impuestos se suman aparte.',
    ] },
    { h2: 'Cómo buscar en Casa Libre', paras: [
      `Filtrá por ${o.label === 'en alquiler' ? 'alquiler' : 'venta'}, tipo, precio y dormitorios, y mirá cada opción en el mapa con fotos. El contacto es directo por WhatsApp con la inmobiliaria o el dueño, desde la web o la app para iPhone y Android.`,
    ] },
  ];

  const faq = path ? [
    { q: `¿Cuánto cuesta ${verb} ${un} ${t.sing} en ${cityName}?`, a: `El precio típico publicado hoy es ${ph('median')}${periodo}, con un rango de ${ph('min')} a ${ph('max')} (${ph('count')} ${t.plural} ${o.label} en Casa Libre, ${'{{month}}'}).` },
    { q: `¿${FEM.has(useTipo) ? 'Cuántas' : 'Cuántos'} ${t.plural} ${o.label} hay en ${cityName}?`, a: `Hay ${ph('count')} ${pub} en Casa Libre en este momento, de inmobiliarias y de dueños particulares.` },
    { q: '¿Cómo contacto al dueño o a la inmobiliaria?', a: 'Desde cada aviso, por WhatsApp, sin intermediarios ni registro obligatorio.' },
  ] : [
    { q: '¿Dónde veo los precios publicados?', a: `En Casa Libre, filtrando por zona, tipo de propiedad y precio en el mapa de ${countryName}.` },
  ];

  const related = tipo ? [[useOp, useTipo]] : [];
  return {
    slug, kind: 'guide', term,
    title: `${h1}: precios de ${'{{month}}'}`.slice(0, 90),
    h1: question.length <= 90 ? question : h1,
    description: path
      ? `Cuánto cuesta ${verb} ${un} ${t.sing} en ${cityName}: precio típico, rango y cantidad de opciones publicadas hoy en Casa Libre. Datos reales, actualizados cada mes.`
      : `Respuesta corta y datos reales de propiedades publicadas en ${countryName}.`,
    answer, sections, faq, related, answerPath: path,
  };
}

function trendDraft({ term, slug, countryName = 'Paraguay', capitalSlug, capitalName, news = [] }) {
  const rent = capitalSlug ? `/alquiler/departamentos/${capitalSlug}` : null;
  const sale = capitalSlug ? `/venta/casas/${capitalSlug}` : null;
  const city = capitalName || countryName;
  const heads = news.slice(0, 3).map((n) => `«${n.title}»${n.source ? ` (${n.source})` : ''}`);
  return {
    slug, kind: 'trend_post', term,
    title: `${cap(term)}: qué cambia para quien alquila o compra en ${countryName}`.slice(0, 90),
    h1: `${cap(term)}: qué cambia para quien alquila o compra en ${countryName}`,
    description: `${cap(term)} es tendencia en ${countryName}. Qué puede significar para alquileres y compras de vivienda, con los precios publicados hoy en Casa Libre.`,
    answer: `«${term}» es una de las búsquedas que más crecen hoy en ${countryName}. Para quien busca vivienda, lo práctico es mirar los precios publicados: en ${city}, un departamento en alquiler pide en promedio {{median:${rent}}} por mes y una casa en venta {{median:${sale}}} (Casa Libre, {{month}}).`,
    sections: [
      { h2: 'Qué se está diciendo', paras: heads.length ? [`Los titulares de estos días: ${heads.join('; ')}.`, 'Cuando el tema toca precios, tasas o el tipo de cambio, suele notarse primero en los alquileres en dólares y en las cuotas de crédito.'] : ['Es un tema con mucha búsqueda en el país estos días.'] },
      { h2: `Los precios publicados hoy en ${city}`, paras: [
        `Departamentos en alquiler: {{count:${rent}}} opciones, precio típico {{median:${rent}}} por mes, de {{min:${rent}}} a {{max:${rent}}}.`,
        `Casas en venta: {{count:${sale}}} opciones, precio típico {{median:${sale}}}, de {{min:${sale}}} a {{max:${sale}}}.`,
        'Estos números se actualizan solos cada mes con lo publicado en Casa Libre.',
      ] },
      { h2: 'Qué conviene hacer', paras: ['Compará opciones parecidas en el mapa antes de decidir, y preguntá directamente al dueño o a la inmobiliaria por WhatsApp qué incluye el precio.'] },
    ],
    faq: [
      { q: `¿Cuánto cuesta alquilar un departamento en ${city}?`, a: `El precio típico publicado hoy es {{median:${rent}}} por mes ({{count:${rent}}} opciones en Casa Libre, {{month}}).` },
    ],
    related: capitalSlug ? [['alquiler', 'departamentos'], ['venta', 'casas']] : [],
    answerPath: rent,
  };
}
