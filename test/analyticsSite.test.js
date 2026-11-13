import { describe, it, expect } from 'vitest';
import { SITE_EXPR, siteClause, siteOf, NOT_FUNNEL } from '../lib/analyticsSite.js';

describe('analytics country site', () => {
  it('El Salvador: its airosofts host and .com.sv both count as sv, whatever site_country says', () => {
    expect(siteOf({ $host: 'casa-libre-el-salvador.apps.airosofts.com', site_country: 'py' })).toBe('sv');
    expect(siteOf({ $host: 'casa-libre.com.sv' })).toBe('sv');
    expect(siteOf({ $host: 'www.casa-libre.com.sv' })).toBe('sv');
    expect(siteOf({ $host: 'sv.casa-libre.com', site_country: 'py' })).toBe('sv');   // the live address since Nov 6 2026
    expect(siteOf({ $host: 'casa-libre.com' })).toBe('py');                          // the hub is not El Salvador
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
    expect(siteClause('')).toBe(` AND ${NOT_FUNNEL}`);
    expect(siteClause("py' OR 1=1")).toBe(` AND ${NOT_FUNNEL}`);
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
});
