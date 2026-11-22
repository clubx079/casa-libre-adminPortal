import { describe, it, expect } from 'vitest';
import { applyMark, testReason } from '../lib/testAccounts.js';
import { isInternalEmail } from '../lib/internalTraffic.js';

describe('test & review accounts', () => {
  it('marks and unmarks by lower-case email', () => {
    const a = applyMark({}, ' Test@X.com ', true, 'omar', '2026-11-22T00:00:00Z');
    expect(a).toEqual({ 'test@x.com': { at: '2026-11-22T00:00:00Z', by: 'omar' } });
    expect(applyMark(a, 'TEST@x.com', false)).toEqual({});
    expect(applyMark({}, 'no-email', true)).toEqual({});
  });
  it('says why an account is hidden', () => {
    expect(testReason('a@b.com', { marked: { 'a@b.com': { by: 'omar' } } }).kind).toBe('marked');
    expect(testReason('a@b.com', { isTeam: true }).kind).toBe('team');
    expect(testReason('a@b.com', { isPakistan: true }).kind).toBe('pakistan');
    expect(testReason('a@b.com')).toBe(null);
  });
  it('the Apple reviewer and the typo account are team accounts', () => {
    expect(isInternalEmail('hd9gwbyjry@privaterelay.appleid.com')).toBe(true);
    expect(isInternalEmail('omar@airosofts.co')).toBe(true);
    expect(isInternalEmail('cynthiamfeldmann@gmail.com')).toBe(false);
  });
});
