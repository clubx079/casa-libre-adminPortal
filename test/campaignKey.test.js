import { describe, it, expect } from 'vitest';
import { campaignOf, CAMPAIGN_KEY } from '../lib/campaignKey.js';

describe('campaignOf: the batch a visitor came from', () => {
  const names = new Map([['wc-agents-batch-3-image-ab12', 'Agents · Batch 3 · Image']]);
  const byRef = new Map([['0vkq83t', 'Agents · Batch 5 · US mascot GIF']]);
  it('a batch link (utm_campaign = the batch slug) → the batch name', () => {
    expect(campaignOf('wc-agents-batch-3-image-ab12', names, byRef)).toEqual({ campaign: 'wc-agents-batch-3-image-ab12', label: 'Agents · Batch 3 · Image' });
  });
  it('a reply link (audience|person code) → the batch that person was in', () => {
    expect(campaignOf('agentes_lanzamiento|0vkq83t', names, byRef)).toEqual({ campaign: 'agentes_lanzamiento', label: 'Agents · Batch 5 · US mascot GIF' });
  });
  it('a reply link whose person is in no batch (a test send) → the audience campaign, unnamed', () => {
    expect(campaignOf('inmobiliarias_lanzamiento|zzz9999', names, byRef)).toEqual({ campaign: 'inmobiliarias_lanzamiento', label: '' });
  });
  it('anything else is left as it is', () => {
    expect(campaignOf('', names, byRef)).toEqual({ campaign: '', label: '' });
    expect(campaignOf('rd_launch', names, byRef)).toEqual({ campaign: 'rd_launch', label: '' });
  });
  it('the HogQL key only splits reply-link visits', () => {
    expect(CAMPAIGN_KEY).toContain("'mensaje'");
    expect(CAMPAIGN_KEY).toContain('utm_term');
  });
});

describe('referral-link visits', () => {
  it('the HogQL key gives one campaign per person\'s link, and campaignOf names it', async () => {
    const { CAMPAIGN_KEY, campaignOf } = await import('../lib/campaignKey');
    expect(CAMPAIGN_KEY).toContain("concat('ref-', toString(properties.utm_content))");
    expect((CAMPAIGN_KEY.match(/\(/g) || []).length).toBe((CAMPAIGN_KEY.match(/\)/g) || []).length);
    expect(campaignOf('ref-abcd2345', new Map([['ref-abcd2345', "Carlos G.'s link"]]))).toEqual({ campaign: 'ref-abcd2345', label: "Carlos G.'s link" });
  });
  it('SOURCE_EXPR calls it a referral link, before the generic utm_source branch', async () => {
    const { SOURCE_EXPR } = await import('../lib/posthogSql');
    const i = SOURCE_EXPR.indexOf("'referral link'");
    expect(i).toBeGreaterThan(0);
    expect(i).toBeLessThan(SOURCE_EXPR.indexOf('lower(properties.utm_source)'));
    expect((SOURCE_EXPR.match(/\(/g) || []).length).toBe((SOURCE_EXPR.match(/\)/g) || []).length);
  });
});
