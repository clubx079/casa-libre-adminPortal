import { describe, it, expect } from 'vitest';
import { isInternalContact, isInternalEmail, countryName, HIDDEN_EMAIL_TYPES } from '../lib/internalTraffic.js';

describe('team / test contacts are hidden', () => {
  it('by name or email of the team', () => {
    expect(isInternalContact({ buyer_name: 'Omar Faiz' })).toBe(true);
    expect(isInternalContact({ buyer_name: '  omar faiz ' })).toBe(true);
    expect(isInternalContact({ buyer_name: 'Omar New' })).toBe(true);
    expect(isInternalContact({ buyer_email: 'Omar57new@gmail.com' })).toBe(true);
    expect(isInternalContact({ buyer_email: 'omar@airosofts.com' })).toBe(true);
  });
  it('by the dev team country, as a code (saved by the website) or a name (from PostHog)', () => {
    expect(isInternalContact({ buyer_country: 'PK' })).toBe(true);
    expect(isInternalContact({ buyer_country: 'Pakistan' })).toBe(true);
  });
  it('real buyers stay', () => {
    expect(isInternalContact({ buyer_name: 'Omar Benítez', buyer_country: 'PY' })).toBe(false);
    expect(isInternalContact({ buyer_email: 'luis@gmail.com', buyer_country: 'Paraguay' })).toBe(false);
    expect(isInternalContact({})).toBe(false);
  });
});

describe('countryName', () => {
  it('ISO code or name → a readable name', () => {
    expect(countryName('PY')).toBe('Paraguay');
    expect(countryName('py')).toBe('Paraguay');
    expect(countryName('United States')).toBe('United States');
    expect(countryName('')).toBe(null);
  });
});

describe('isInternalEmail', () => {
  it('team emails, Omar test accounts and any .pk address', () => {
    for (const e of ['omar@airosofts.com', 'OMAR57NEW@gmail.com', 'omarsap6@gmail.com', 'omar@airosofts.con', 'review@casa-libre.com.py', 'l232502@lhr.nu.edu.pk']) expect(isInternalEmail(e), e).toBe(true);
  });
  it('real buyers and sellers are not', () => {
    for (const e of ['claudi.pato.rami@gmail.com', 'roland@southerninvestment.co', '', null, 'x@pk.com']) expect(isInternalEmail(e), String(e)).toBe(false);
  });
  it('extra emails found at runtime (PostHog / sign-up IP in Pakistan) count too', () => {
    expect(isInternalEmail('someone@gmail.com', new Set(['someone@gmail.com']))).toBe(true);
  });
});

describe('test addresses and team notification emails', () => {
  it('the four test addresses are internal', () => {
    for (const e of ['putin571105@gmail.com', 'siliconpixels.org@gmail.com', 'clubx079@gmail.com', 'info@casa-libre.com']) expect(isInternalEmail(e), e).toBe(true);
  });
  it('team notifications and test sends are never counted as emails to users', () => {
    expect(HIDDEN_EMAIL_TYPES).toEqual(['Test send', 'Book a call', 'Investor inquiry']);
  });
});
