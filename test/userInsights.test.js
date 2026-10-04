import { describe, it, expect } from 'vitest';
import { HIDE_DELETED_USERS, isDeletedEmail, normalizeEmail, listingSummary } from '../lib/userInsights.js';

describe('deleted accounts', () => {
  it('filters out accounts removed through "Delete account" (AiroBase like uses %)', () => {
    expect(HIDE_DELETED_USERS).toBe('email=not.like.%25%40deleted.invalid');
  });
  it('recognises a deleted account email', () => {
    expect(isDeletedEmail('deleted-1a2b@deleted.invalid')).toBe(true);
    expect(isDeletedEmail('DELETED-1a2b@Deleted.Invalid ')).toBe(true);
    expect(isDeletedEmail('ana@gmail.com')).toBe(false);
    expect(isDeletedEmail('')).toBe(false);
    expect(isDeletedEmail(null)).toBe(false);
  });
});

describe('normalizeEmail', () => {
  it('trims and lowercases a real address', () => {
    expect(normalizeEmail('  Ana.Perez@Gmail.com ')).toBe('ana.perez@gmail.com');
  });
  it('rejects anything that is not one email address', () => {
    for (const bad of ['', 'ana', 'a@b', 'a@b.c,d@e.f', 'a b@c.de', null, 'x'.repeat(250) + '@a.co']) {
      expect(normalizeEmail(bad)).toBe(null);
    }
  });
});

describe('listingSummary', () => {
  it('maps a listing row to what the user page shows', () => {
    expect(listingSummary({
      id: 'p1', address: 'Av. España 123', neighborhood: 'Villa Morra', city: 'Asunción', listing_type: 'alquiler',
      property_type: 'casa', price: 1500000, currency: 'PYG', admin_status: 'active', feature_image_url: 'https://x/y.jpg', created_at: '2026-10-01T10:00:00Z',
    })).toEqual({
      id: 'p1', title: 'Av. España 123', place: 'Villa Morra, Asunción', operation: 'alquiler', type: 'casa',
      price: 1500000, currency: 'PYG', live: true, image: 'https://x/y.jpg', created_at: '2026-10-01T10:00:00Z',
    });
  });
  it('falls back when address/neighborhood are missing and marks inactive listings', () => {
    const s = listingSummary({ id: 'p2', city: 'Luque', admin_status: 'inactive' });
    expect(s.title).toBe('Luque');
    expect(s.place).toBe('Luque');
    expect(s.live).toBe(false);
    expect(s.price).toBe(null);
  });
  it('does not repeat the city when the neighborhood is the same', () => {
    const s = listingSummary({ id: 'p3', neighborhood: 'Encarnación', city: 'encarnación ', admin_status: 'active' });
    expect(s.place).toBe('Encarnación');
    expect(s.title).toBe('Encarnación');
  });
});
