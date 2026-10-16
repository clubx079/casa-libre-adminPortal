import { describe, it, expect } from 'vitest';
import { rangeFor, adsActionKind, adsAcquisition, ADS_TRACKING_SINCE } from '../lib/marketingReport.js';

const act = (id, name, action, v) => ({ campaign: { id, name }, segments: { conversionActionName: action }, metrics: { allConversions: v } });

describe('ads-only CAC', () => {
  it('classifies only the real contact / sign-up actions', () => {
    expect(adsActionKind('Casa Libre (web) contact_whatsapp_click')).toBe('whatsapp');
    expect(adsActionKind('Casa Libre (web) contact_call_click')).toBe('call');
    expect(adsActionKind('Casa Libre (web) contact_copy_click')).toBe('copy');
    expect(adsActionKind('Sign-up (Google Analytics event user_signed_up)')).toBe('signup');
    expect(adsActionKind('Page view')).toBe(null);
    expect(adsActionKind('Contact (Google Analytics event oauth_login_clicked)')).toBe(null);
    expect(adsActionKind('Casa Libre (web) form_submit')).toBe(null);
    expect(adsActionKind(undefined)).toBe(null);
  });
  it('totals, per campaign, cost per contact and CAC from ads', () => {
    const range = rangeFor(30, new Date('2026-10-16T12:00:00Z'));
    const r = adsAcquisition({
      campaigns: [
        { campaign: { id: '1', name: 'Search_Rent', status: 'ENABLED' }, metrics: { costMicros: '300000000' } },
        { campaign: { id: '2', name: 'Competitors', status: 'ENABLED' }, metrics: { costMicros: '100000000' } },
        { campaign: { id: '3', name: 'Old', status: 'PAUSED' }, metrics: { costMicros: '0' } },
      ],
      actions: [
        act('1', 'Search_Rent', 'Casa Libre (web) contact_whatsapp_click', 4),
        act('1', 'Search_Rent', 'Casa Libre (web) contact_copy_click', 1),
        act('1', 'Search_Rent', 'Casa Libre (web) contact_call_click', 1),
        act('1', 'Search_Rent', 'Sign-up (Google Analytics event user_signed_up)', 2),
        act('1', 'Search_Rent', 'Page view', 817.5),
        act('1', 'Search_Rent', 'Contact (Google Analytics event oauth_login_clicked)', 1),
        act('2', 'Competitors', 'Page view', 58.5),
      ],
    }, range);
    expect(r.total).toEqual({ spend: 400, contacts: 6, whatsapp: 4, call: 1, copy: 1, signups: 2, costPerContact: 66.67, cac: 200 });
    expect(r.campaigns.map((c) => c.name)).toEqual(['Search_Rent', 'Competitors']);
    expect(r.campaigns[0]).toMatchObject({ spend: 300, contacts: 6, costPerContact: 50, signups: 2, cac: 150 });
    expect(r.campaigns[1]).toMatchObject({ spend: 100, contacts: 0, costPerContact: null, signups: 0, cac: null });
    expect(r.trackingSince).toBe(ADS_TRACKING_SINCE);
    expect(r.partial).toBe(true);
    expect(r.sinceTracking).toBe(null);   // no daily rows passed
  });
  it('since tracking started: only the spend from Oct 13 on', () => {
    const range = rangeFor(30, new Date('2026-10-16T12:00:00Z'));
    const r = adsAcquisition({
      campaigns: [{ campaign: { id: '1', name: 'A' }, metrics: { costMicros: '500000000' } }],
      actions: [act('1', 'A', 'Casa Libre (web) contact_whatsapp_click', 4), act('1', 'A', 'Sign-up (Google Analytics event user_signed_up)', 1)],
      daily: [
        { segments: { date: '2026-10-12' }, metrics: { costMicros: '400000000' } },
        { segments: { date: '2026-10-13' }, metrics: { costMicros: '60000000' } },
        { segments: { date: '2026-10-16' }, metrics: { costMicros: '40000000' } },
      ],
    }, range);
    expect(r.total).toMatchObject({ spend: 500, costPerContact: 125, cac: 500 });
    expect(r.sinceTracking).toEqual({ spend: 100, costPerContact: 25, cac: 100 });
    expect(adsAcquisition({ daily: [{ segments: { date: '2026-11-02' }, metrics: { costMicros: '1' } }] }, { start: '2026-11-01' }).sinceTracking).toBe(null);
  });
  it('nothing tracked → no cost per anything; period after tracking start is not partial', () => {
    const r = adsAcquisition({ campaigns: [{ campaign: { id: '1', name: 'A' }, metrics: { costMicros: '5000000' } }] }, { start: '2026-11-01', end: '2026-11-07' });
    expect(r.total).toMatchObject({ spend: 5, contacts: 0, signups: 0, costPerContact: null, cac: null });
    expect(r.partial).toBe(false);
    expect(adsAcquisition({}, null).total.spend).toBe(0);
  });
});
