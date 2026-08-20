// Machine reason code -> human label for quarantined ingest records.
// Plain module (no server-only) so both the server pipeline and the client
// review page can import it — keep the codes in sync with lib/ingest.js.
export const REASON_LABELS = {
  no_contact: 'Sin teléfono de contacto',
  no_location: 'Sin ciudad ni barrio',
  no_price: 'Sin precio',
  price_below_floor: 'Precio por debajo del mínimo plausible',
  sale_price_as_rent: 'Precio de venta publicado como alquiler',
  beds_over_cap: 'Dormitorios fuera de rango (>10)',
  baths_over_cap: 'Baños fuera de rango (>10)',
  parking_over_cap: 'Cocheras fuera de rango (>10)',
  area_out_of_range: 'Superficie construida fuera de rango (5–2.000 m²)',
  duplicate: 'Duplicado de una propiedad ya publicada',
  images_broken: 'Todas las imágenes están rotas',
};
