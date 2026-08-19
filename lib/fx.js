// Live USD -> PYG (guaraníes) exchange rate for dual-currency display.
// Uses the free, key-less open.er-api.com feed, cached ~6h in-memory and via the
// Next fetch cache. Falls back to the PYG_PER_USD env value if the feed is down.
import 'server-only';

const TTL = 6 * 3600 * 1000;
let cache = null; // { pyg, at }

const fallback = () => Number(process.env.PYG_PER_USD) || 7300;

// Guaraníes per 1 USD.
export async function getUsdToPyg() {
  if (cache && Date.now() - cache.at < TTL) return cache.pyg;
  try {
    const r = await fetch('https://open.er-api.com/v6/latest/USD', { next: { revalidate: 21600 } });
    if (r.ok) {
      const d = await r.json();
      const pyg = d?.rates?.PYG;
      if (pyg && Number.isFinite(Number(pyg))) {
        cache = { pyg: Number(pyg), at: Date.now() };
        return cache.pyg;
      }
    }
  } catch { /* fall through to fallback */ }
  const fb = fallback();
  cache = { pyg: fb, at: Date.now() };
  return fb;
}
