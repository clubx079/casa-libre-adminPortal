// AI SEO for the sites — the FEED each site reads (GET /api/seo-sites/feed?site=<domain>), kept 60 s in
// this server's memory so six sites × many pages cost one DB read per minute per site. Never throws:
// on a DB error the last good copy is served, else an empty feed. Server-only.
import 'server-only';
import { seoDb } from '../seo/store.js';
import { scopeOf, siteFor } from './scope.js';
import { buildFeed } from './shape.js';

const TTL = 60_000;
const cache = (globalThis.__seoSiteFeed ||= new Map());   // key → { at, feed }
const enc = encodeURIComponent;

export function clearFeed(key) { cache.delete(key); }

export async function getFeed(siteOrKey) {
  const site = typeof siteOrKey === 'string' ? siteFor(siteOrKey) : siteOrKey;
  if (!site) return null;
  const hit = cache.get(site.key);
  if (hit && Date.now() - hit.at < TTL) return hit.feed;
  const scope = enc(scopeOf(site.key));
  try {
    const db = seoDb('py');
    const [drafts, overrides] = await Promise.all([
      db.select('seo_drafts', `select=slug,status,title,h1,description,answer,sections,faq,related,created_at,updated_at,approved_at&country=eq.${scope}&status=eq.approved&order=approved_at.desc&limit=2000`),
      db.select('seo_overrides', `select=path,title,h1,description,extra_links&country=eq.${scope}&limit=5000`),
    ]);
    const feed = buildFeed(site, drafts, overrides);
    cache.set(site.key, { at: Date.now(), feed });
    return feed;
  } catch (e) {
    if (hit) { cache.set(site.key, { at: Date.now() - TTL + 15_000, feed: hit.feed }); return hit.feed; }   // retry in 15 s
    return { ...buildFeed(site, [], []), error: 'feed temporarily unavailable' };
  }
}
