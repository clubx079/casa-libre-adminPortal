import { describe, it, expect } from 'vitest';
import { livePriceVars } from '../lib/priceVars.js';
import { buildFactSheet } from '../lib/aiFacts.js';
import { systemPrompt } from '../lib/aiPrompt.js';

// live PY settings (Nov 20): list US$29 −80 % = US$5.80 for 60 days, extend US$5 for 30 days, 2 free a month
const PAID = { id: 'paid_listings', enabled: true, milestones: [2900, 80, 500, 2], free_days: 60, later_free_days: 30, first_tier_count: 2, template_id: 'ending', reminder_template_id: 'ended', gift_template_id: 'agents' };
const AUTOS = [PAID, { id: 'payment_followup', template_id: 'pay1' }, { id: 'first_listing_free_home', template_id: 'gift', free_days: 30 }];

describe('template preview shows the REAL prices of this country', () => {
  it('"ended" / "ends soon" → the extension price and days, not US$20', () => {
    const r = livePriceVars('ended', AUTOS);
    expect(r.vars.price).toBe('US$5');
    expect(r.vars.free_days).toBe('30');
    expect(livePriceVars('ending', AUTOS).vars.price).toBe('US$5');
  });
  it('payment follow-up and the agent plan → the listing price and days', () => {
    expect(livePriceVars('pay1', AUTOS).vars).toMatchObject({ price: 'US$5.80', paid_days: '60', free_limit: '2' });
    expect(livePriceVars('agents', AUTOS).vars.price).toBe('US$5.80');
  });
  it('first-listing gift → the home-page price', () => {
    expect(livePriceVars('gift', AUTOS).vars.price).toBe('US$20');
  });
  it('changing the setting changes every preview', () => {
    const cheaper = [{ ...PAID, milestones: [2900, 80, 300, 2], later_free_days: 15 }];
    expect(livePriceVars('ended', cheaper).vars).toMatchObject({ price: 'US$3', free_days: '15' });
  });
});

describe('Inbox AI: no prices or days typed in', () => {
  it('fact sheet takes days and prices from the settings and names no other portal', () => {
    const f = JSON.stringify(buildFactSheet({ cc: 'py', countryName: 'Paraguay', site: 'https://casa-libre.com.py', paid: { enabled: true, freePerMonth: 2, price: 'US$5.80', days: 60, extendPrice: 'US$5', extendDays: 30 } }));
    expect(f).toContain('"extra_listing_lasts_days":60');
    expect(f).toContain('US$5 for 30 more days');
    expect(f).not.toMatch(/InfoCasas|US\$40|90/);
  });
  it('the prompt no longer says 90 days or quotes other portals', () => {
    const p = systemPrompt('Paraguay');
    expect(p).not.toMatch(/90 days|US\$40|other portals charge/);
    expect(p).toContain('US$5 · 30 días');
    expect(p).toContain('US$20 · 30 días');
  });
});
