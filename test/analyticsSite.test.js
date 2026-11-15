import { describe, it, expect } from 'vitest';
import { SITE_EXPR, siteClause, siteOf, NOT_FUNNEL, NOT_HUB, IS_HUB } from '../lib/analyticsSite.js';

describe('analytics country site', () => {
  it('El Salvador: its airosofts host and .com.sv both count as sv, whatever site_country says', () => {
    expect(siteOf({ $host: 'casa-libre-el-salvador.apps.airosofts.com', site_country: 'py' })).toBe('sv');
    expect(siteOf({ $host: 'casa-libre.com.sv' })).toBe('sv');
    expect(siteOf({ $host: 'www.casa-libre.com.sv' })).toBe('sv');
    expect(siteOf({ $host: 'sv.casa-libre.com', site_country: 'py' })).toBe('sv');   // the live address since Nov 6 2026
    expect(siteOf({ $host: 'casa-libre.com' })).toBe('hub');                         // the hub is not El Salvador (nor Paraguay)
    expect(siteOf({ $host: 'localhost:3000', site_country: 'sv' })).toBe('sv');
  });

  it('keeps the existing countries and the PY default', () => {
    expect(siteOf({ $host: 'casa-libre.com.bo' })).toBe('bo');
    expect(siteOf({ $host: 'uy.casa-libre.com' })).toBe('uy');
    expect(siteOf({ $host: 'casa-libre.com.ve' })).toBe('ve');
    expect(siteOf({ $host: 'casa-libre.com.py', site_country: 'py' })).toBe('py');
    expect(siteOf({ $host: 'casa-libre.com.py' })).toBe('py');
    expect(siteOf({})).toBe('py');
  });

  it('every country code scopes to itself — never all sites (which is ~all Paraguay)', () => {
    expect(siteClause('sv')).toBe(` AND ${SITE_EXPR} = 'sv'`);
    expect(siteClause('SV')).toBe(` AND ${SITE_EXPR} = 'sv'`);
    expect(siteClause('ar')).toBe(` AND ${SITE_EXPR} = 'ar'`);   // a country without a site yet → its own (empty) data
    expect(siteClause('py')).toBe(` AND ${SITE_EXPR} = 'py'`);
    expect(siteClause('')).toBe(` AND ${NOT_FUNNEL} AND ${NOT_HUB}`);
    expect(siteClause("py' OR 1=1")).toBe(` AND ${NOT_FUNNEL} AND ${NOT_HUB}`);
  });

  it('HogQL: the sv host regex is in the expression, escaped as a HogQL string', () => {
    expect(SITE_EXPR).toContain(String.raw`casa-libre-el-salvador\\.apps\\.airosofts\\.com`);
    expect(SITE_EXPR).toContain(String.raw`'(?i)(casa-libre\\.com\\.bo)'), 'bo'`);
    expect(SITE_EXPR.indexOf("'sv'")).toBeLessThan(SITE_EXPR.indexOf('site_country'));
  });

  it('funnel-site events (funnel_site set, no site_country) never count as a country site', () => {
    expect(siteOf({ funnel_site: 'owners', funnel_country: 'py', $host: 'vender-mi-casa.com' })).toBe('funnel');
    expect(siteOf({ funnel_site: 'agents', $host: 'casa-libre.com.bo' })).toBe('funnel');
    expect(SITE_EXPR.indexOf("'funnel'")).toBeLessThan(SITE_EXPR.indexOf("'bo'"));
    expect(NOT_FUNNEL).toContain('funnel_site');
  });

  it('casa-libre.com hub events (hub_site set, or host casa-libre.com / www.) never count as a country site', () => {
    expect(siteOf({ hub_site: true, hub_lang: 'es', $host: 'casa-libre.com' })).toBe('hub');
    expect(siteOf({ hub_site: 'true', $host: 'localhost:3000' })).toBe('hub');
    expect(siteOf({ $host: 'www.casa-libre.com' })).toBe('hub');
    expect(siteOf({ $host: 'CASA-LIBRE.COM' })).toBe('hub');
    // the country sites are not the hub
    expect(siteOf({ $host: 'casa-libre.com.py' })).toBe('py');
    expect(siteOf({ $host: 'uy.casa-libre.com' })).toBe('uy');
    expect(siteOf({ $host: 'sv.casa-libre.com' })).toBe('sv');
    expect(siteOf({ $host: 'casa-libre.com.bo', hub_site: false })).toBe('bo');
    // a funnel event stays a funnel event
    expect(siteOf({ funnel_site: 'owners', hub_site: true })).toBe('funnel');
  });

  it('HogQL: hub bucket comes before the countries, its host regex is anchored and escaped, and all-sites excludes it', () => {
    expect(SITE_EXPR).toContain(`${IS_HUB}, 'hub'`);
    expect(SITE_EXPR.indexOf("'hub'")).toBeLessThan(SITE_EXPR.indexOf("'bo'"));
    expect(SITE_EXPR.indexOf("'funnel'")).toBeLessThan(SITE_EXPR.indexOf("'hub'"));
    expect(IS_HUB).toContain('hub_site');
    expect(IS_HUB).toContain(String.raw`'(?i)^(www\\.)?casa-libre\\.com$'`);
    expect(NOT_HUB).toBe(`NOT ${IS_HUB}`);
    expect(siteClause('py')).not.toContain('NOT_HUB');
    expect(siteClause('')).toContain(NOT_HUB);
  });
});
