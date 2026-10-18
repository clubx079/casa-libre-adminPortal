import { describe, it, expect } from 'vitest';
import { hiddenReason, reasonDetail } from '../lib/hiddenReason.js';

const live = { admin_status: 'active', is_complete: true, status: 'published' };

describe('hiddenReason', () => {
  it('a live listing has no reason', () => {
    expect(hiddenReason(live)).toBe(null);
  });
  it('reads the website status first', () => {
    for (const s of ['scanning', 'duplicate_review', 'payment_pending', 'expired']) {
      expect(hiddenReason({ ...live, status: s, admin_status: 'inactive' })).toEqual({ code: s });
    }
  });
  it('rejected photos count the failed ones', () => {
    const r = { status: 'rejected', admin_status: 'inactive', is_complete: true, moderation: { photos: [{ verdict: 'fail' }, { verdict: 'pass' }, { verdict: 'fail' }] } };
    expect(hiddenReason(r)).toEqual({ code: 'rejected', failedPhotos: 2, totalPhotos: 3 });
    expect(reasonDetail(hiddenReason(r), { lang: 'en' })).toBe('2 of 3 photos failed the check');
  });
  it('switched off by hand, incomplete, quarantine', () => {
    expect(hiddenReason({ ...live, admin_status: 'inactive' })).toEqual({ code: 'admin_off' });
    expect(hiddenReason({ ...live, is_complete: false })).toEqual({ code: 'incomplete' });
    expect(hiddenReason({ _held: true })).toEqual({ code: 'quarantine' });
  });
});
