import { describe, it, expect } from 'vitest';
import { validateAppUpdates, settingsFromRow, compareVersions, writableCountries } from '../lib/appUpdatesAdmin.js';

describe('Mobile app updates (admin)', () => {
  it('compares versions', () => {
    expect(compareVersions('1.4.0', '1.10.0')).toBe(-1);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('2.0.0', '1.9.9')).toBe(1);
  });

  it('saves only the filled values (empty = the site keeps its env value)', () => {
    const v = validateAppUpdates({ enabled: true, android: { min: '1.3.0', latest: '1.4.0', storeUrl: '' }, ios: { min: '', latest: ' 1.4.0 ' }, testEmails: 'Omar@Airosofts.com, qa@x.com', test: { android: { min: '9.9.9' } } });
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ enabled: true, free_tiers: [{ android: { min: '1.3.0', latest: '1.4.0' }, ios: { latest: '1.4.0' }, test: { android: { min: '9.9.9' }, ios: {} }, testEmails: ['omar@airosofts.com', 'qa@x.com'] }] });
  });

  it('rejects bad input', () => {
    const v = validateAppUpdates({ android: { min: '1.5.0', latest: '1.4.0' }, ios: { latest: 'v2', storeUrl: 'apps.apple.com' }, testEmails: 'nope' });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['android.min', 'ios.latest', 'ios.storeUrl', 'testEmails']);
  });

  it('row → form, and no row → empty form', () => {
    expect(settingsFromRow(null)).toMatchObject({ enabled: false, android: { min: '', latest: '', storeUrl: '' }, testEmails: '' });
    const f = settingsFromRow({ enabled: true, updated_at: 'x', free_tiers: [{ ios: { latest: '1.4.0' }, testEmails: ['a@b.co'] }] });
    expect(f).toMatchObject({ enabled: true, ios: { latest: '1.4.0', min: '' }, testEmails: 'a@b.co', updatedAt: 'x' });
  });

  it('only writes to countries that have their own database', () => {
    const env = { AIROBASE_URL_BO: 'x', AIROBASE_URL_SV: 'y' };
    expect(writableCountries([{ code: 'py' }, { code: 'bo' }, { code: 'uy' }, { code: 'SV' }], env, 'py')).toEqual(['py', 'bo', 'sv']);
  });
});
