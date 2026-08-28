// Machine reason code -> human label (ES/EN) for quarantined ingest records.
// Plain module (no server-only) so both the server pipeline and the client
// review page can import it — keep the codes in sync with lib/ingest.js.
export const REASON_LABELS = {
  no_contact:        { es: 'Sin teléfono de contacto',                     en: 'No contact phone' },
  no_location:       { es: 'Sin ciudad ni barrio',                          en: 'No city or neighborhood' },
  no_price:          { es: 'Sin precio',                                    en: 'No price' },
  price_below_floor: { es: 'Precio por debajo del mínimo plausible',        en: 'Price below the plausible minimum' },
  price_above_ceiling:{ es: 'Precio por encima del máximo plausible (>USD 50M)', en: 'Price above the plausible maximum (>USD 50M)' },
  sale_price_as_rent:{ es: 'Precio de venta publicado como alquiler',       en: 'Sale price listed as rent' },
  beds_over_cap:     { es: 'Dormitorios fuera de rango (>10)',              en: 'Bedrooms out of range (>10)' },
  baths_over_cap:    { es: 'Baños fuera de rango (>10)',                     en: 'Bathrooms out of range (>10)' },
  parking_over_cap:  { es: 'Cocheras fuera de rango (>10)',                  en: 'Parking spaces out of range (>10)' },
  area_out_of_range: { es: 'Superficie construida fuera de rango (5–2.000 m²)', en: 'Built area out of range (5–2,000 m²)' },
  duplicate:         { es: 'Duplicado de una propiedad ya publicada',       en: 'Duplicate of an already-published property' },
  images_broken:     { es: 'Todas las imágenes están rotas',                en: 'All images are broken' },
};

// Resolve a reason code to its label in the given language (falls back to ES,
// then the raw code).
export function reasonLabel(code, lang) {
  const r = REASON_LABELS[code];
  if (!r) return code;
  return (lang === 'en' ? r.en : r.es) || r.es || code;
}
