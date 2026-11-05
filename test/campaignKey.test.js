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
