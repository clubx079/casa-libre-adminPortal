// Pure dual-currency helpers (importable from server and client).
// `rate` = guaraníes (PYG) per 1 USD. Kept in sync with the buyer portal.

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

// Given an original price + its currency, return both USD and PYG amounts. The
// ORIGINAL currency keeps its exact value; only the CONVERTED side is rounded.
export function dualPrice(price, currency, rate) {
  if (price == null || !rate) return { usd: null, pyg: null };
  const p = Number(price);
  if (!Number.isFinite(p)) return { usd: null, pyg: null };
  const cur = String(currency || '').toUpperCase();
  if (cur === 'PYG') return { usd: roundConverted(Math.round(p / rate)), pyg: Math.round(p) };
  // USD (or unknown) is treated as USD
  return { usd: Math.round(p), pyg: roundConverted(Math.round(p * rate)) };
}

export function fmtUsd(v, loc) {
  return v == null ? '—' : 'US$ ' + Number(v).toLocaleString(loc || 'es-PY');
}
export function fmtPyg(v, loc) {
  return v == null ? '—' : 'Gs. ' + Number(v).toLocaleString(loc || 'es-PY');
}
