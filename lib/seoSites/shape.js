// AI SEO for the sites — the site guide object ↔ the seo_drafts row, and the FEED the sites read
// (pure — test/seoSites.test.js). Server side: lib/seoSites/feedCache.js + app/api/seo-sites/feed.
//   seo_drafts row of a site: country 'site:<key>', slug, kind 'guide'|'trend_post', title/h1/description/answer,
//   sections (SITE format: [{ id, h2, blocks: [{t:'p',html}|{t:'ul',items}] }]), faq [{q,a}],
//   related = { cc, navLabel, blurb, summary: [string] }
//   feed = { site, updatedAt, guides: [<site guide object>] (approved only), overrides: [{ path, title, h1, description, extraLinks }] }
import { cleanGuide, safeHref, plainText } from './sanitize.js';

const day = (v) => (v ? String(v).slice(0, 10) : null);

export function guideToRow(scope, g, extra = {}) {
  return {
    country: scope, slug: g.slug, kind: extra.kind || 'guide', term: extra.term ?? null,
    title: g.title, h1: g.h1, description: g.description, answer: g.answer,
    sections: g.sections, faq: g.faq,
    related: { cc: g.cc, navLabel: g.navLabel, blurb: g.blurb, summary: g.summary || [] },
    source: extra.source || 'claude', model: extra.model ?? null, note: extra.note ?? null,
    updated_at: new Date().toISOString(),
  };
}

/** A seo_drafts row → the site guide object (cleaned again; null when unusable). */
export function rowToGuide(row, site) {
  if (!row) return null;
  const rel = row.related && !Array.isArray(row.related) && typeof row.related === 'object' ? row.related : {};
  try {
    return cleanGuide({
      cc: rel.cc, slug: row.slug, title: row.title, h1: row.h1, description: row.description, answer: row.answer,
      navLabel: rel.navLabel, blurb: rel.blurb, summary: rel.summary, sections: row.sections, faq: row.faq,
      published: day(row.approved_at || row.created_at), updated: day(row.updated_at || row.approved_at),
    }, site, { cc: site.countries.includes(rel.cc) ? rel.cc : site.rootCountry, slug: row.slug });
  } catch { return null; }
}

/** A seo_overrides row → the feed's override (internal links only; null when it changes nothing). */
export function rowToOverride(row) {
  if (!row?.path || !String(row.path).startsWith('/')) return null;
  const extraLinks = (Array.isArray(row.extra_links) ? row.extra_links : [])
    .map((l) => ({ href: safeHref(l?.href), label: plainText(l?.label).slice(0, 120) }))
    .filter((l) => l.href && l.href.startsWith('/') && l.label);
  const o = { path: row.path, title: row.title ? plainText(row.title) : null, h1: row.h1 ? plainText(row.h1) : null, description: row.description ? plainText(row.description) : null, extraLinks };
  return o.title || o.h1 || o.description || extraLinks.length ? o : null;
}

export function buildFeed(site, drafts = [], overrides = [], now = new Date()) {
  const guides = drafts.filter((d) => d.status === 'approved').map((d) => rowToGuide(d, site)).filter(Boolean);
  const seen = new Set();
  const uniq = guides.filter((g) => { const k = `${g.cc}|${g.slug}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return { site: site.domain, updatedAt: now.toISOString(), guides: uniq, overrides: overrides.map(rowToOverride).filter(Boolean) };
}
