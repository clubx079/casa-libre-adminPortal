// Data for "Results of our changes" (lib/seo/impact.js): the AI SEO's page changes of the last 90 days
// and Search Console's page × day numbers for exactly those pages. Server-only.
//   impactBuyer(cc)   a country's buyer portal (changes in that country DB)
//   impactSite(site)  one of the six SEO sites or the hub (changes in the PY DB, country 'site:<key>')
import 'server-only';
import { seoDb } from './store.js';
import { changedPages, dataRange, impactFor, normPath } from './impact.js';
import { gscQuery } from '../googleApi';
import { siteFor as gscSiteFor } from '../searchConsole';

const enc = encodeURIComponent;
const day = (d) => d.toISOString().slice(0, 10);
const LAST_DAY = () => day(new Date(Date.now() - 2 * 86400000));   // Search Console is complete ~2 days later
const MAX_PAGES = 120;
const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function loadChanges(cc, scope) {
  const since = new Date(Date.now() - 90 * 86400000).toISOString();
  return seoDb(cc).select('seo_changes', `select=action,path,before,after,created_at,reverted_at&country=eq.${enc(scope)}&action=in.(enable_variant,publish_guide,set_title,add_links)&created_at=gte.${enc(since)}&order=created_at.asc&limit=2000`);
}

// page × date rows for these paths only (regex filters, ≤ ~60 paths per query to stay under Google's limit)
async function pageDays(query, paths, range) {
  const rows = [];
  for (let i = 0; i < paths.length; i += 60) {
    const part = paths.slice(i, i + 60);
    const expression = `^https?://[^/]+(${part.map((p) => reEsc(p === '/' ? '' : p)).join('|')})/?$`;
    const j = await query({
      startDate: range.start, endDate: range.end, type: 'web', dimensions: ['page', 'date'], rowLimit: 25000,
      dimensionFilterGroups: [{ groupType: 'and', filters: [{ dimension: 'page', operator: 'includingRegex', expression }] }],
    });
    for (const r of j.rows || []) rows.push({ page: normPath(r.keys[0]), date: r.keys[1], impressions: r.impressions || 0, clicks: r.clicks || 0, position: r.position || 0 });
  }
  return rows;
}

async function build(changes, query, note) {
  const pages = changedPages(changes).slice(-MAX_PAGES);
  const lastDay = LAST_DAY();
  if (!pages.length) return { ...impactFor([], [], { lastDay }), note };
  const range = dataRange(pages, lastDay);
  let rows = [];
  let error = null;
  try { rows = await pageDays(query, pages.map((p) => p.path), range); } catch (e) { error = String(e?.message || e).slice(0, 200); }
  return { ...impactFor(pages, rows, { lastDay }), range, error, note };
}

export async function impactBuyer(cc) {
  const site = await gscSiteFor(cc);
  const changes = await loadChanges(cc, cc);
  if (!site) return { ...impactFor(changedPages(changes), [], { lastDay: LAST_DAY() }), error: 'No Search Console access for this country.' };
  return { ...(await build(changes, (body) => gscQuery(site.property, body), null)), origin: site.origin };
}

export async function impactSite(site) {
  const { siteGsc } = await import('../seoSites/run.js');
  const changes = await loadChanges('py', `site:${site.key}`);
  return { ...(await build(changes, (body) => siteGsc(site, body), null)), origin: `https://${site.domain}` };
}
