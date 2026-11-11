import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  PAGES, ROLE_PRESETS, API_PAGES, normalizeAccess, allowedPages, accessLabel, sessionPages,
  pageKeyForPath, canOpenPath, homeFor,
} from '../lib/adminPages';

const admin = (access) => ({ role: 'admin', access });
const superadmin = { role: 'superadmin', access: { preset: 'sales' } };

describe('normalizeAccess / allowedPages', () => {
  it('null, full and junk mean every page', () => {
    for (const v of [null, undefined, '', { preset: 'full' }, 'not json', 42]) expect(normalizeAccess(v)).toBeNull();
    expect(allowedPages(null)).toBeNull();
  });
  it('a ready-made role keeps only its name; its pages come from the code', () => {
    expect(normalizeAccess({ preset: 'marketing', pages: ['earnings'] })).toEqual({ preset: 'marketing' });
    expect(allowedPages({ preset: 'marketing' })).toEqual(ROLE_PRESETS.marketing.pages);
    expect(allowedPages({ preset: 'marketing' })).not.toContain('marketing');   // no Google Ads
    expect(allowedPages({ preset: 'marketing' })).not.toContain('earnings');
  });
  it('custom drops unknown keys, de-duplicates and keeps the sidebar order', () => {
    expect(normalizeAccess({ preset: 'custom', pages: ['leads', 'nope', 'inbox', 'leads'] })).toEqual({ preset: 'custom', pages: ['leads', 'inbox'] });
    expect(normalizeAccess(JSON.stringify({ pages: ['users'] }))).toEqual({ preset: 'custom', pages: ['users'] });
    expect(normalizeAccess({ preset: 'custom', pages: [] })).toEqual({ preset: 'custom', pages: [] });
  });
  it('labels', () => {
    expect(accessLabel(null)).toBe('Full access');
    expect(accessLabel({ preset: 'sales' })).toBe('Sales agent');
    expect(accessLabel({ preset: 'custom', pages: ['inbox'] })).toBe('Custom · 1 page');
  });
  it('every preset page exists', () => {
    const keys = new Set(PAGES.map((p) => p.key));
    for (const p of Object.values(ROLE_PRESETS)) for (const k of p.pages || []) expect(keys.has(k), k).toBe(true);
  });
});

describe('paths', () => {
  it('maps dashboard paths to pages', () => {
    expect(pageKeyForPath('/')).toBe('overview');
    expect(pageKeyForPath('/properties?kind=originals')).toBe('properties');
    expect(pageKeyForPath('/manager/abc')).toBe('manager');
    expect(pageKeyForPath('/scraper-status')).toBe('scraper-status');   // not swallowed by /scrape
    expect(pageKeyForPath('/contacts')).toBe('utm-links');
  });
  it('Super Admins and full access open everything', () => {
    expect(sessionPages(superadmin)).toBeNull();
    expect(canOpenPath(superadmin, '/earnings')).toBe(true);
    expect(canOpenPath(admin(null), '/api/earnings')).toBe(true);
  });
  it('a marketing manager sees their pages and APIs only', () => {
    const s = admin({ preset: 'marketing' });
    expect(canOpenPath(s, '/campaigns')).toBe(true);
    expect(canOpenPath(s, '/api/campaigns/abc')).toBe(true);
    expect(canOpenPath(s, '/analytics')).toBe(true);
    expect(canOpenPath(s, '/api/users/123')).toBe(true);        // the Analytics page reads it
    expect(canOpenPath(s, '/marketing')).toBe(false);           // Google Ads
    expect(canOpenPath(s, '/api/google/oauth/start')).toBe(false);
    expect(canOpenPath(s, '/earnings')).toBe(false);
    expect(canOpenPath(s, '/api/earnings')).toBe(false);
  });
  it('always open: Account, auth, country switch, badges', () => {
    const s = admin({ preset: 'custom', pages: [] });
    for (const p of ['/team', '/api/team', '/api/auth/logout', '/api/auth/refresh', '/api/country', '/api/unread', '/api/translate-preview']) expect(canOpenPath(s, p), p).toBe(true);
    expect(canOpenPath(s, '/')).toBe(false);
    expect(homeFor(s)).toBe('/team');
  });
  it('an unknown API is closed to a restricted role', () => {
    expect(canOpenPath(admin({ preset: 'sales' }), '/api/something-new')).toBe(false);
  });
  it('home is the first allowed page in sidebar order', () => {
    expect(homeFor(admin({ preset: 'custom', pages: ['leads', 'inbox'] }))).toBe('/leads');
    expect(homeFor(admin({ preset: 'sales' }))).toBe('/');
  });
  it('every app/api folder is mapped (a new API must be given its pages)', () => {
    const dir = path.join(__dirname, '..', 'app', 'api');
    const always = ['auth', 'country', 'unread', 'translate-preview', 'media', 'team', 'cron', 'relay'];
    const folders = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory());
    const unmapped = folders.filter((f) => !always.includes(f) && !API_PAGES[f]);
    expect(unmapped).toEqual([]);
  });
});
