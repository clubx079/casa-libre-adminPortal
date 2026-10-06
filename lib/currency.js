// Each country's own currency for prices in the admin — the same profiles as the
// buyer portal's lib/country.js (code, prefix, locale). Venezuela prices are in US$
// only, so it has no local line. Plain module: server and client components.
export const CURRENCY = {
  py: { code: 'PYG', prefix: 'Gs. ', locale: 'es-PY', fallbackRate: 7300 },
  bo: { code: 'BOB', prefix: 'Bs ', locale: 'es-BO', fallbackRate: 12.5 },
  uy: { code: 'UYU', prefix: '$U ', locale: 'es-UY', fallbackRate: 40 },
  ve: { code: 'USD', prefix: '', locale: 'es-VE', fallbackRate: 1 },
};
export const currencyFor = (cc) => CURRENCY[String(cc || 'py').toLowerCase()] || CURRENCY.py;

// Monthly rent floor (same rule as the buyer portal's lib/rentFloor.js): Paraguay
// keeps ₲300,000; elsewhere 300,000 local units means nothing (bolivianos, pesos,
// dollars), so the US$ equivalent is used.
export const RENT_FLOOR_PYG = 300000;
export const RENT_FLOOR_USD = 40;
