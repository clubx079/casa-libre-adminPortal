// Pure dual-currency helpers (importable from server and client).
// `rate` = LOCAL currency units per 1 USD (guaraníes in Paraguay, bolivianos in
// Bolivia, pesos in Uruguay — lib/currency.js). Kept in sync with the buyer portal.
import { currencyFor } from './currency';

// Round a CONVERTED (approximate) amount to ~3 significant digits so the FX-derived
// side doesn't imply false precision (e.g. Gs. 873,475,873 -> Gs. 873,000,000).
export function roundConverted(v) {
  if (!v || !Number.isFinite(v)) return v;
  const abs = Math.abs(v);
  let step;
  if (abs >= 100_000_000) step = 1_000_000;
  else if (abs >= 10_000_000) step = 100_000;
  else if (abs >= 1_000_000) step = 10_000;
  else if (abs >= 100_000) step = 1_000;
  else if (abs >= 10_000) step = 1_000;
  else if (abs >= 1_000) step = 100;
  else if (abs >= 100) step = 10;
  else step = 1;
  return Math.round(v / step) * step;
}

// Given an original price + its currency, return both USD and local amounts
// (`pyg` = the local side; the key name is kept for back-compat). The ORIGINAL
// currency keeps its exact value; only the CONVERTED side is rounded. localCode =
// the country's currency (currencyFor(cc).code); Paraguay (PYG) is the default.
export function dualPrice(price, currency, rate, localCode = 'PYG') {
  if (price == null || !rate) return { usd: null, pyg: null };
  const p = Number(price);
  if (!Number.isFinite(p)) return { usd: null, pyg: null };
  const cur = String(currency || '').toUpperCase();
  if (localCode === 'USD') return { usd: Math.round(p), pyg: null };   // dollar country: no local side
  if (cur === localCode) return { usd: roundConverted(Math.round(p / rate)), pyg: Math.round(p) };
  // USD (or unknown) is treated as USD
  return { usd: Math.round(p), pyg: roundConverted(Math.round(p * rate)) };
}

export function fmtUsd(v, loc) {
  return v == null ? '—' : 'US$ ' + Number(v).toLocaleString(loc || 'es-PY');
}
export function fmtPyg(v, loc) {
  return v == null ? '—' : 'Gs. ' + Number(v).toLocaleString(loc || 'es-PY');
}
// The local-currency side for a country (Gs. / Bs / $U); '' where there is none (Venezuela).
export function fmtLocal(v, cc, loc) {
  const c = currencyFor(cc);
  if (!c.prefix) return '';
  return v == null ? '—' : c.prefix + Number(v).toLocaleString(loc || c.locale);
}
