// Pure dual-currency helpers (importable from server and client).
// `rate` = guaraníes (PYG) per 1 USD.

// Given an original price + its currency, return both USD and PYG amounts.
export function dualPrice(price, currency, rate) {
  if (price == null || !rate) return { usd: null, pyg: null };
  const p = Number(price);
  if (!Number.isFinite(p)) return { usd: null, pyg: null };
  const cur = String(currency || '').toUpperCase();
  if (cur === 'PYG') return { usd: Math.round(p / rate), pyg: Math.round(p) };
  // USD (or unknown) is treated as USD
  return { usd: Math.round(p), pyg: Math.round(p * rate) };
}

export function fmtUsd(v, loc) {
  return v == null ? '—' : 'US$ ' + Number(v).toLocaleString(loc || 'es-PY');
}
export function fmtPyg(v, loc) {
  return v == null ? '—' : 'Gs. ' + Number(v).toLocaleString(loc || 'es-PY');
}
