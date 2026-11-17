// Stage 8 — Improve (the weekly loop): what to change on pages that are already live (pure —
// test/seoImprove.test.js). Runner: lib/seo/run.js runImprove().
//   new_title       many impressions, low CTR → a title in the words of the top Search Console query
//                   (applied only when the 14-day rate limit allows and auto titles are on)
//   strengthen_page the page slipped in position week on week → more internal links
//   retire_variant  an enabled variant with no impressions for N weeks → noindex, out of the sitemap
import { canChangeTitle, cleanTitle } from './guards.js';
import { parsePath } from './matrix.js';

const fold = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

// Two titles that say the same thing ("… en Asunción …" vs "… Asunción …") — not worth a change.
const STOP = new Set(['en', 'de', 'del', 'la', 'el', 'los', 'las', 'y', 'a', 'para', 'opciones', 'count', 'propiedades']);
export const sameWords = (a, b) => {
  const w = (s) => [...new Set(fold(s).replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((x) => x && !STOP.has(x)))].sort().join(' ');
  return !!a && !!b && w(a) === w(b);
};

// "alquiler departamentos asuncion" → "Alquiler departamentos Asunción — {count} opciones"
// ({count} is filled by the website at render time with the live listing count)
export function titleFromQuery(query, cities = []) {
  let q = String(query || '').replace(/\s+/g, ' ').trim();
  if (!q) return null;
  for (const c of cities) {
    const re = new RegExp(`(^|\\s)${fold(c.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|\\s)`, 'i');
    const f = fold(q);
    const m = re.exec(f);
    if (m) { const at = m.index + m[1].length; q = q.slice(0, at) + c.name + q.slice(at + c.name.length); }
  }
  q = q.charAt(0).toUpperCase() + q.slice(1);
  return cleanTitle(`${q} — {count} opciones`);
}

// pages: [{ page, cur: { impressions, clicks, ctr, position }, prev: {…}, topQuery }]
// variants: [{ path, enabledAt, impressions }]   (impressions over the last N weeks)
export function improveActions({ pages = [], variants = [], overridesByPath = new Map(), settings, cities = [], now = new Date() }) {
  const t = settings.thresholds;
  const out = [];
  for (const p of pages) {
    const path = p.page;
    // titles + links are ours to change on the matrix pages only (guides' copy lives in the guide)
    if (!parsePath(path)) continue;
    const ov = overridesByPath.get(path) || {};
    if (p.cur.impressions >= t.lowCtrImpressions && (p.cur.ctr || 0) < t.lowCtr && p.topQuery) {
      const title = titleFromQuery(p.topQuery, cities);
      if (title && !sameWords(title, ov.title)) {
        const rl = canChangeTitle(ov, now, t.titleDays);
        out.push({ type: 'new_title', url: path, term: p.topQuery, title, allowed: rl.ok, nextAt: rl.nextAt,
          reason: `${p.cur.impressions} impressions, CTR ${(100 * (p.cur.ctr || 0)).toFixed(1)}% (< ${(100 * t.lowCtr).toFixed(1)}%): title from the top search "${p.topQuery}"` });
      }
    }
    if (p.prev?.position && p.cur.position && p.cur.position - p.prev.position >= t.slipPositions && p.cur.impressions >= 10) {
      out.push({ type: 'strengthen_page', url: path, term: p.topQuery || path,
        reason: `position slipped ${p.prev.position.toFixed(1)} → ${p.cur.position.toFixed(1)} week on week: add internal links` });
    }
  }
  const weeks = t.zeroTrafficWeeks;
  for (const v of variants) {
    const since = Date.parse(v.enabledAt || 0);
    if (!since || now.getTime() - since < weeks * 7 * 86400000) continue;
    if ((v.impressions || 0) > 0) continue;
    if (!parsePath(v.path)?.variant) continue;
    out.push({ type: 'retire_variant', url: v.path, term: v.path, reason: `no Google impressions in ${weeks} weeks since it was switched on: hide it (noindex)` });
  }
  return out;
}
