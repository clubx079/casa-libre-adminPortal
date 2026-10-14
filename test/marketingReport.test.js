import { describe, it, expect } from 'vitest';
import { rangeFor, daysOf, adsReport, outcomes } from '../lib/marketingReport.js';

describe('marketing report', () => {
  it('period and days', () => {
    const r = rangeFor(7, new Date('2026-10-14T18:00:00Z'));
    expect([r.start, r.end, r.days]).toEqual(['2026-10-08', '2026-10-14', 7]);
    expect(daysOf(r)).toHaveLength(7);
    expect(rangeFor('abc').days).toBe(30);
  });
  it('ads: totals, per day (gaps filled), campaigns, real vs page-view conversions', () => {
    const range = rangeFor(7, new Date('2026-10-14T12:00:00Z'));
    const a = adsReport({
      campaigns: [
        { campaign: { id: '1', name: 'Rent', status: 'ENABLED' }, metrics: { costMicros: '300000000', clicks: '1000', impressions: '4000', conversions: 600 } },
        { campaign: { id: '2', name: 'Old', status: 'PAUSED' }, metrics: { costMicros: '0', clicks: '0', impressions: '0', conversions: 0 } },
      ],
      daily: [{ segments: { date: '2026-10-10' }, metrics: { costMicros: '12280000', clicks: '28', conversions: 18 } }],
      actions: [{ segments: { conversionActionName: 'Page view' }, metrics: { conversions: 597 } }, { segments: { conversionActionName: 'contact_whatsapp_click' }, metrics: { conversions: 3 } }],
    }, range);
    expect(a.total).toMatchObject({ cost: 300, clicks: 1000, ctr: 25, cpc: 0.3, conversions: 600, realConversions: 3, costPerRealConversion: 100 });
    expect(a.campaigns.map((c) => c.name)).toEqual(['Rent']);
    expect(a.series).toHaveLength(7);
    expect(a.series.find((d) => d.key === '2026-10-10')).toMatchObject({ cost: 12.28, clicks: 28 });
    expect(a.conversionActions[0]).toMatchObject({ name: 'Page view', soft: true });
  });
  it('cost per sign-up / contact', () => {
    expect(outcomes({ signups: 25, contacts: 110, listings: 0 }, { cost: 462 })).toMatchObject({ costPerSignup: 18.48, costPerContact: 4.2, costPerListing: null });
  });
});
