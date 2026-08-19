// Human-readable, translated property-type labels. Source types are messy
// (Spanish, mixed case, per-source strings, numeric codes), so match by keyword
// and map to a canonical label in the requested language. Pure — usable anywhere.

// Order matters: more specific patterns first.
const RULES = [
  [/loteamiento|\blote\b|lotes/i, { es: 'Loteamiento', en: 'Land subdivision' }],
  [/terreno|parcela|fracci/i, { es: 'Terreno', en: 'Land' }],
  [/campo|estancia|chacra|granja/i, { es: 'Campo', en: 'Farm / Ranch' }],
  [/d[uú]plex/i, { es: 'Dúplex', en: 'Duplex' }],
  [/casa|residencia|residencial|chalet|vivienda|house/i, { es: 'Casa', en: 'House' }],
  [/departamento|depto|monoambiente|penthouse|apartment|pozo/i, { es: 'Departamento', en: 'Apartment' }],
  [/condominio|barrio\s*cerrado/i, { es: 'Condominio', en: 'Condominium' }],
  [/oficina|office/i, { es: 'Oficina', en: 'Office' }],
  [/dep[oó]sito|galp[oó]n|warehouse/i, { es: 'Depósito', en: 'Warehouse' }],
  [/local|comercial|commercial/i, { es: 'Local comercial', en: 'Commercial' }],
  [/edificio|building/i, { es: 'Edificio', en: 'Building' }],
  [/inmueble.?productivo/i, { es: 'Inmueble productivo', en: 'Income property' }],
  [/hotel/i, { es: 'Hotel', en: 'Hotel' }],
  [/propiedad|inmueble|property/i, { es: 'Propiedad', en: 'Property' }],
];

// Returns a translated label, or null for meaningless values (bare numeric codes).
export function typeLabel(raw, lang) {
  if (raw == null || String(raw).trim() === '') return null;
  const s = String(raw).trim();
  for (const [re, lab] of RULES) if (re.test(s)) return lang === 'en' ? lab.en : lab.es;
  if (/^\d+$/.test(s)) return null; // source-internal numeric code -> hide
  // Unknown but human — clean it up (e.g. "casa-en-condominio" already matched above)
  const cleaned = s.replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}
