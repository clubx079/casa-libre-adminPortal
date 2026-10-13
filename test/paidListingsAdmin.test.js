import { describe, it, expect } from 'vitest';
import { paidConfig, priceCents, usd, validatePaidSettings, samePersonGroups, paidStats, DEFAULT_TEMPLATES } from '../lib/paidListingsAdmin.js';
import { validateTemplate, templateUsage } from '../lib/automationAdmin.js';
import { emailType } from '../lib/emailStats.js';

describe('paid listings settings', () => {
  it('no row = off with the defaults (3 free, US$29 −80% = US$5.80, 90 days, +30 days US$5)', () => {
    const c = paidConfig(null);
    expect(c.enabled).toBe(false);
    expect(c.freePerMonth).toBe(3);
    expect(usd(priceCents(c))).toBe('US$5.80');
    expect([c.days, c.extendDays, usd(c.extendCents)]).toEqual([90, 30, 'US$5']);
  });

  it('the form maps to the automations row fields', () => {
    const v = validatePaidSettings({ freePerMonth: 3, listPrice: '29', discountPct: 80, days: 90, extendPrice: '5', extendDays: 30, remindDaysBefore: 3, samePersonMin: 2, endingTemplateId: 'a', endedTemplateId: 'b', agentTemplateId: 'c', enabled: true }, null, '2026-10-13T00:00:00Z');
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ first_tier_count: 3, free_days: 90, later_free_days: 30, remind_days_before: 3, milestones: [2900, 80, 500, 2], template_id: 'a', reminder_template_id: 'b', gift_template_id: 'c', enabled: true, enabled_at: '2026-10-13T00:00:00Z' });
    expect(paidConfig(v.value).freePerMonth).toBe(3);
  });

  it('rejects bad numbers and switching on without the three emails', () => {
    expect(validatePaidSettings({ freePerMonth: -1 }).errors.freePerMonth).toBeTruthy();
    expect(validatePaidSettings({ listPrice: 'abc' }).errors.listPrice).toBeTruthy();
    expect(validatePaidSettings({ listPrice: '1', discountPct: 95 }).errors.discountPct).toMatch(/0.50/);
    expect(validatePaidSettings({ remindDaysBefore: 40, extendDays: 30 }).errors.remindDaysBefore).toBeTruthy();
    expect(validatePaidSettings({ enabled: true }).errors.enabled).toMatch(/template/);
  });

  it('keeps enabled_at when it was already on', () => {
    const v = validatePaidSettings({ freePerMonth: 2 }, { id: 'paid_listings', enabled: true, enabled_at: 'x', template_id: 'a', reminder_template_id: 'b', gift_template_id: 'c' });
    expect(v.ok).toBe(true);
    expect(v.value.enabled_at).toBeUndefined();
    expect(v.value.enabled).toBe(true);
  });

  it('the default emails are valid templates with known variables', () => {
    for (const t of DEFAULT_TEMPLATES) expect(validateTemplate(t).ok).toBe(true);
  });

  it('template usage + email types know the paid-listing emails', () => {
    expect(templateUsage('a', [{ id: 'paid_listings', template_id: 'a' }])).toEqual(['Paid listings → ends-soon email']);
    expect(emailType('Tu publicación termina en 3 días')).toBe('Paid listing ending');
    expect(emailType('Tu publicación terminó')).toBe('Paid listing ended');
    expect(emailType('Un plan para agentes e inmobiliarias')).toBe('Agents plan');
  });
});

describe('same person + stats', () => {
  it('groups accounts that share 2 of 3 signals', () => {
    const g = samePersonGroups([
      { created_by: 'u1', raw_data: { signals: { device_id: 'd1', fp: 'f1', ip: '1.1.1.1' } } },
      { created_by: 'u2', raw_data: { signals: { device_id: 'd1', fp: 'f2', ip: '1.1.1.1' } } },
      { created_by: 'u3', raw_data: { signals: { device_id: 'd3', fp: 'f3', ip: '1.1.1.1' } } },
    ], 2);
    expect(g).toEqual([{ users: ['u1', 'u2'], matched: ['device_id', 'ip'] }]);
  });

  it('counts this month', () => {
    const s = paidStats({
      monthStart: '2026-10-01T03:00:00.000Z',
      payments: [
        { kind: 'listing_free', status: 'free', amount_usd: 0, created_at: '2026-10-02' },
        { kind: 'listing', status: 'succeeded', amount_usd: 5.8, created_at: '2026-10-03' },
        { kind: 'listing_extend', status: 'succeeded', amount_usd: 5, created_at: '2026-10-04' },
        { kind: 'listing', status: 'failed', amount_usd: 5.8, created_at: '2026-10-04' },
        { kind: 'listing', status: 'succeeded', amount_usd: 5.8, created_at: '2026-09-04' },
      ],
      props: [{ status: 'payment_pending' }, { status: 'published', raw_data: { paid_listing: { state: 'active' } } }, { status: 'expired', raw_data: { paid_listing: { state: 'expired' } } }],
    });
    expect(s).toEqual({ freeThisMonth: 1, paidThisMonth: 1, extendedThisMonth: 1, revenueThisMonth: 10.8, revenueAllTime: 16.6, pending: 1, activePaid: 1, ended: 1 });
  });
});
