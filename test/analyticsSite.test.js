import { describe, it, expect } from 'vitest';
import { SITE_EXPR, siteClause, siteOf } from '../lib/analyticsSite.js';

describe('analytics country site', () => {
  it('El Salvador: its airosofts host and .com.sv both count as sv, whatever site_country says', () => {
    expect(siteOf({ $host: 'casa-libre-el-salvador.apps.airosofts.com', site_country: 'py' })).toBe('sv');
    expect(siteOf({ $host: 'casa-libre.com.sv' })).toBe('sv');
    expect(siteOf({ $host: 'www.casa-libre.com.sv' })).toBe('sv');
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
    expect(siteClause('')).toBe('');
    expect(siteClause("py' OR 1=1")).toBe('');
  });

  it('HogQL: the sv host regex is in the expression, escaped as a HogQL string', () => {
    expect(SITE_EXPR).toContain(String.raw`casa-libre-el-salvador\\.apps\\.airosofts\\.com`);
    expect(SITE_EXPR).toContain(String.raw`'(?i)(casa-libre\\.com\\.bo)'), 'bo'`);
    expect(SITE_EXPR.indexOf("'sv'")).toBeLessThan(SITE_EXPR.indexOf('site_country'));
  });
});
