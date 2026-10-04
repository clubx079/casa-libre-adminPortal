// The admin "UTM Links" page: ONE link per channel (lib/campaigns.js) and, for each,
//   opened — times its /r/ link was opened (link_click, recorded by the redirect;
//            bots and link previews skipped). Old links (/r/rda…) count too.
//   landed — people who reached the site carrying that channel's utm tags.
// Pure — no fetch — so vitest can check it (test/campaigns.test.js).

// utm_campaign names the old per-placement links used, so visits that arrived
// through them still count under their channel.
export const LEGACY_CAMPAIGNS = {
  rd: ['reddit_agent', 'reddit_organic'],
  ig: ['instagram_bio', 'instagram_story'],
  fb: ['facebook_page'],
  tt: ['tiktok_bio'],
  meta: ['meta_ads_sellers'],
  wa: ['manual_outreach'],
  mail: ['manual_outreach'],
};

// Everything put into SQL here comes from code, but check anyway.
const SAFE = /^[a-z0-9_]+$/;
const lit = (v) => {
  if (!SAFE.test(String(v))) throw new Error(`unsafe value for SQL: ${v}`);
  return `'${v}'`;
};

// link_click's slug, with old aliases mapped to their channel ('rda' → 'rd').
export function clickSlugSql(aliases = {}) {
  const from = Object.keys(aliases);
  const to = from.map((k) => aliases[k]);
  const slug = "lower(coalesce(properties.slug, ''))";
  return from.length ? `transform(${slug}, [${from.map(lit).join(', ')}], [${to.map(lit).join(', ')}], ${slug})` : slug;
}

// A page view's channel slug from its utm_source + utm_campaign, or '' if none.
export function landingChannelSql(campaigns = {}, legacy = {}) {
  const parts = Object.entries(campaigns).map(([slug, c]) => {
    const names = [...new Set([c.name, ...(legacy[slug] || [])])];
    return `lower(coalesce(properties.utm_source, '')) = ${lit(c.source)} AND coalesce(properties.utm_campaign, '') IN (${names.map(lit).join(', ')}), ${lit(slug)}`;
  });
  return parts.length ? `multiIf(${parts.join(', ')}, '')` : "''";
}

// clicks:   [[slug, opened, lastOpened]]  (slug already mapped to its channel)
// landings: [[slug, people, lastLanded]]
export function buildLinksReport({ campaigns = {}, site = '', clicks = [], landings = [] }) {
  const base = String(site).replace(/\/$/, '');
  const opened = new Map(clicks.map(([s, n, last]) => [s, { n: Number(n) || 0, last: last || null }]));
  const landed = new Map(landings.map(([s, n]) => [s, Number(n) || 0]));
  return Object.entries(campaigns).map(([slug, c]) => ({
    slug,
    label: c.label,
    link: `${base}/r/${slug}`,
    opened: opened.get(slug)?.n || 0,
    landed: landed.get(slug) || 0,
    lastOpened: opened.get(slug)?.last || null,
  }));
}
