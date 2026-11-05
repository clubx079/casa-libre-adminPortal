import { describe, it, expect } from 'vitest';
import { portfolioCount, tierOf, needsPerson, portfolioNote, leadNotes, portfolioEmail, ALERT_EMAIL_TO } from '../lib/agencyOffer';

describe('agency offer by portfolio size (Roland, Nov 5 2026)', () => {
  it('reads the count the assistant returned', () => {
    expect(portfolioCount(63)).toBe(63);
    expect(portfolioCount('29')).toBe(29);
    expect(portfolioCount(0)).toBe(0);
    expect(portfolioCount(-4)).toBe(0);
    expect(portfolioCount(null)).toBe(0);
    expect(portfolioCount('muchas')).toBe(0);
  });
  it('the tiers: 1–10 self-serve, 11–200 migrate, 200+ custom', () => {
    expect(tierOf(0)).toBe(null);
    expect(tierOf(1)).toBe('self');
    expect(tierOf(10)).toBe('self');
    expect(tierOf(11)).toBe('migrate');
    expect(tierOf(63)).toBe('migrate');
    expect(tierOf(200)).toBe('migrate');
    expect(tierOf(201)).toBe('custom');
    expect([5, 11, 63, 500].map(needsPerson)).toEqual([false, true, true, true]);
  });
  it('the alert note names the count and the tier', () => {
    expect(portfolioNote(63)).toMatch(/Agency portfolio: 63 listings \(11–200 listings: we migrate up to 100 free for 6 months\)/);
    expect(portfolioNote(500)).toMatch(/200\+ listings: custom offer/);
    expect(portfolioNote(4)).toMatch(/self-serve offer/);
    expect(portfolioNote(0)).toBe('');
  });
  it('the lead keeps one portfolio line, the newest', () => {
    const d = new Date('2026-11-05T12:00:00Z');
    expect(leadNotes('12 agents on Ubicaprop', 63, d)).toBe('12 agents on Ubicaprop · Portfolio: 63 listings (WhatsApp, 2026-11-05)');
    expect(leadNotes('12 agents on Ubicaprop · Portfolio: 63 listings (WhatsApp, 2026-11-05)', 70, new Date('2026-11-06T00:00:00Z'))).toBe('12 agents on Ubicaprop · Portfolio: 70 listings (WhatsApp, 2026-11-06)');
    expect(leadNotes(null, 5, d)).toBe('Portfolio: 5 listings (WhatsApp, 2026-11-05)');
    expect(leadNotes('x', 0, d)).toBe('x');
  });
  it('the email goes to omar@ only and says what to do', () => {
    const m = portfolioEmail({ count: 63, phone: '+595971340234', name: 'CENTURY 21 Access', said: 'Tenemos 63 propiedades', reply: 'Migramos hasta 100…', link: 'https://admin.casa-libre.com/inbox?phone=595971340234' });
    expect(ALERT_EMAIL_TO).toBe('omar@airosofts.com');
    expect(m.to).toBe('omar@airosofts.com');
    expect(m.subject).toBe('WhatsApp: CENTURY 21 Access (+595971340234) has 63 listings to migrate');
    expect(m.text).toContain('Tenemos 63 propiedades');
    expect(m.text).toContain('inbox?phone=595971340234');
    expect(m.html).not.toMatch(/<script/);
  });
});
