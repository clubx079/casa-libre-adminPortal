// Live USD -> local currency exchange rate for dual-currency display: guaraníes in
// Paraguay, bolivianos in Bolivia, pesos in Uruguay (lib/currency.js); 1 for
// Venezuela, which prices in US$. Uses the free, key-less open.er-api.com feed,
// cached ~6h in-memory and via the Next fetch cache. Falls back to the
// <CODE>_PER_USD env value (e.g. PYG_PER_USD), then the profile's fallback rate.
import 'server-only';
import { currencyFor } from './currency';

const TTL = 6 * 3600 * 1000;
const cache = new Map(); // code -> { rate, at }

// Local currency units per 1 USD for a country.
export async function getUsdRate(cc) {
  const { code, fallbackRate } = currencyFor(cc);
  if (code === 'USD') return 1;
  const hit = cache.get(code);
  if (hit && Date.now() - hit.at < TTL) return hit.rate;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 21600 } });
    if (r.ok) {
      const d = await r.json();
      const rate = Number(d?.rates?.[code]);
      if (rate && Number.isFinite(rate)) {
        cache.set(code, { rate, at: Date.now() });
        return rate;
      }
    }
  } catch { /* fall through to fallback */ }
  const fb = Number(process.env[`${code}_PER_USD`]) || fallbackRate;
  cache.set(code, { rate: fb, at: Date.now() });
  return fb;
}

// Guaraníes per 1 USD (Paraguay) — kept for existing callers.
export async function getUsdToPyg() {
  return getUsdRate('py');
}
