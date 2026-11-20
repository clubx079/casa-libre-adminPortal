// AI SEO for the sites — talking to the six sites (contract: SEO_SITES_SPEC.md). Server-only.
//   fetchCatalog(key)     GET <siteUrl>/api/seo/catalog (Bearer SEO_PUBLISH_SECRET) → the site's STATIC guides
//                         [{ cc, slug, path, title, h1, group }], cached 10 min. Never throws: an unreachable
//                         site gives { ok: false, guides: [], error } and Decide judges coverage from drafts only.
//   startBatch / queuePaths / flushBatch   one publish ping per site per run (Autopilot + Improve queue paths)
//   pingPublish(key, paths)   POST <siteUrl>/api/seo/publish { paths } — best-effort, never throws
// The feed the sites read is served by app/api/seo-sites/feed (lib/seoSites/feedCache.js).
import 'server-only';
import { siteFor, siteUrl } from './scope.js';
import { clearFeed } from './feedCache.js';

const errText = (e) => String(e?.message || e).slice(0, 200);
const auth = () => (process.env.SEO_PUBLISH_SECRET ? { authorization: `Bearer ${process.env.SEO_PUBLISH_SECRET}` } : null);
const catalogs = (globalThis.__seoSiteCatalog ||= new Map());   // key → { at, guides }

export async function fetchCatalog(key, { fresh = false } = {}) {
  const site = siteFor(key);
  if (!site) return { ok: false, guides: [], error: 'unknown site' };
  const hit = catalogs.get(site.key);
  if (!fresh && hit && Date.now() - hit.at < 10 * 60_000) return { ok: true, guides: hit.guides, cached: true };
  const h = auth();
  if (!h) return { ok: false, guides: hit?.guides || [], error: 'no SEO_PUBLISH_SECRET' };
  try {
    const r = await fetch(`${siteUrl(site.key)}/api/seo/catalog`, { headers: h, cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!r.ok) throw new Error(`catalog ${r.status}`);
    const j = await r.json();
    if (!Array.isArray(j?.guides)) throw new Error('catalog: no guides list');
    const guides = j.guides.filter((g) => g && typeof g.slug === 'string').map((g) => ({
      cc: site.countries.includes(g.cc) ? g.cc : site.rootCountry, slug: g.slug,
      path: String(g.path || '').replace(/\/+$/, '') || null, title: String(g.title || ''), h1: String(g.h1 || ''), group: g.group || null,
    }));
    catalogs.set(site.key, { at: Date.now(), guides });
    return { ok: true, guides };
  } catch (e) {
    // the last good copy is still better than nothing
    return { ok: false, guides: hit?.guides || [], stale: !!hit, error: `site catalog unreachable (${errText(e)})` };
  }
}

// ── publish ping ──
const batches = new Map();   // key → Set(paths)
export const hasBatch = (key) => batches.has(key);
export function startBatch(key) { batches.set(key, new Set()); }
export async function flushBatch(key, { always = false } = {}) {
  const b = batches.get(key);
  batches.delete(key);
  if (!b || (!b.size && !always)) return { ok: true, skipped: 'nothing changed' };
  return pingPublish(key, [...b]);
}
/** A change queues its paths while a batch is open; otherwise the site is pinged at once. */
export async function queuePaths(key, paths = []) {
  const b = batches.get(key);
  if (b) { for (const p of paths) if (p) b.add(p); return { ok: true, queued: true }; }
  return pingPublish(key, paths);
}

export async function pingPublish(key, paths = []) {
  const site = siteFor(key);
  if (!site) return { ok: false, error: 'unknown site' };
  clearFeed(site.key);   // the site re-reads the feed right after this ping: it must get the new copy
  const h = auth();
  if (!h) return { ok: false, skipped: 'no SEO_PUBLISH_SECRET' };
  try {
    const r = await fetch(`${siteUrl(site.key)}/api/seo/publish`, {
      method: 'POST', headers: { ...h, 'content-type': 'application/json' },
      body: JSON.stringify({ paths: [...new Set(paths.filter(Boolean))] }), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...(j && typeof j === 'object' ? j : {}) };
  } catch (e) {
    return { ok: false, error: `publish ping failed (${errText(e)}) — the site picks the change up within 5 minutes` };
  }
}
