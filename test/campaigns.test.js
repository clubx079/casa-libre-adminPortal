import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { CAMPAIGNS, ALIASES } from '../lib/campaigns.js';
import { buildLinksReport, clickSlugSql, landingChannelSql, LEGACY_CAMPAIGNS } from '../lib/linksReport.js';

// The admin keeps a copy of the website's link list. When the website repo sits next
// to this one (dev machines), the two must be identical.
const SITE_COPY = new URL('../../casa-libre-BuyerPortal/lib/campaigns.js', import.meta.url);
describe('campaigns copy', () => {
  it.skipIf(!existsSync(SITE_COPY))('matches the website list exactly (channels + old-link aliases)', async () => {
    const site = await import(SITE_COPY.href);
    expect(CAMPAIGNS).toEqual(site.CAMPAIGNS);
    expect(ALIASES).toEqual(site.ALIASES);
  });
});

describe('SQL for the UTM Links page', () => {
  it('counts clicks on old links under their channel', () => {
    const sql = clickSlugSql(ALIASES);
    expect(sql).toContain("transform(lower(coalesce(properties.slug, ''))");
    expect(sql).toContain("'rda'");
    expect(sql).toMatch(/\['rda', 'rdsell', 'rdbuy', 'rdrent', 'igs', 'metasell'\], \['rd', 'rd', 'rd', 'rd', 'ig', 'meta'\]/);
  });
  it('maps a landing to its channel by source + campaign (old campaign names included)', () => {
    const sql = landingChannelSql(CAMPAIGNS, LEGACY_CAMPAIGNS);
    expect(sql).toContain("lower(coalesce(properties.utm_source, '')) = 'reddit' AND coalesce(properties.utm_campaign, '') IN ('reddit', 'reddit_agent', 'reddit_organic'), 'rd'");
    // WhatsApp listing shares (campaign property_share) are NOT the WhatsApp link
    expect(sql).not.toContain('property_share');
  });
  it('only ever puts plain [a-z0-9_] names into the SQL', () => {
    expect(() => landingChannelSql({ bad: { source: "x' OR 1=1 --", name: 'x' } }, {})).toThrow();
  });
});

describe('buildLinksReport', () => {
  const r = buildLinksReport({
    campaigns: CAMPAIGNS,
    site: 'https://casa-libre.com.py/',
    clicks: [['rd', 4, '2026-10-02T04:27:12Z'], ['zzz', 1, '2026-09-22T00:00:00Z']],
    landings: [['rd', 1, '2026-10-02T04:05:00Z'], ['wa', 2, '2026-10-01T10:00:00Z']],
  });

  it('one row per channel, in the list order, with its link', () => {
    expect(r.map((x) => x.label)).toEqual(['Reddit', 'Facebook', 'Instagram', 'X', 'TikTok', 'Meta ads', 'Google ads', 'WhatsApp', 'Email']);
    expect(r[0]).toEqual({ slug: 'rd', label: 'Reddit', link: 'https://casa-libre.com.py/r/rd', opened: 4, landed: 1, lastOpened: '2026-10-02T04:27:12Z' });
  });
  it('channels with no activity show zeros; unknown slugs are ignored', () => {
    expect(r.find((x) => x.slug === 'x')).toMatchObject({ opened: 0, landed: 0, lastOpened: null });
    expect(r.find((x) => x.slug === 'wa')).toMatchObject({ opened: 0, landed: 2 });
    expect(r.some((x) => x.slug === 'zzz')).toBe(false);
  });
});
