import { describe, it, expect } from 'vitest';
import { channelOf, channelLabel } from '../lib/shareChannels.js';
import {
  shareSql, shareEventScope, summarizeShares, summarizeShareRewards, listingOfReward, topListings, topSellers, listingIdsOf, listingTitle,
} from '../lib/shareStats.js';
import { CATALOG, GROUPS } from '../lib/messageCampaigns.js';

const now = Date.parse('2026-11-22T12:00:00Z');
const ago = (d) => new Date(now - d * 86400000).toISOString();

describe('share channels', () => {
  it('takes the code or the utm_source name', () => {
    expect(channelOf('ig')).toBe('ig');
    expect(channelOf('instagram')).toBe('ig');
    expect(channelOf('Instagram')).toBe('ig');
    expect(channelOf('whatsapp')).toBe('wa');
    expect(channelOf('twitter')).toBe('x');
    expect(channelOf('')).toBe('other');
    expect(channelOf('myspace')).toBe('other');
    expect(channelLabel('fb')).toBe('Facebook');
  });
});

describe('the HogQL', () => {
  it('same filters as Analytics: no Pakistan, this country only', () => {
    const sql = Object.values(shareSql).map((f) => f('bo', 30)).join('\n');
    expect(sql).toMatch(/Pakistan/);
    expect(sql).not.toMatch(/'py'\)/);
    expect(shareSql.visitTotals('bo', 30)).toMatch(/= 'bo'/);
    expect(shareSql.visitTotals('bo', 30)).toMatch(/utm_medium/);
    // the server-side click is scoped by its country property
    expect(shareEventScope('uy')).toMatch(/properties\.country\), ''\)\) = 'uy'/);
    expect(shareSql.eventTotals('py', 90)).toMatch(/INTERVAL 90 DAY/);
    expect(shareSql.eventTotals('py', 7)).toMatch(/INTERVAL 14 DAY/);   // the week before is always there
    expect(shareSql.outcomes('py', 30)).toMatch(/user_signed_up/);
    expect(shareSql.outcomes('py', 30)).toMatch(/IN \(SELECT/);
  });
  it('a bad country never reaches the SQL', () => {
    expect(shareEventScope("x'; DROP")).toMatch(/'py'/);
  });
});

describe('summarizeShares', () => {
  const out = summarizeShares({
    eventTotals: [
      ['listing_share_opened', 40, 30, 12, 8, 10, 7],
      ['listing_shared', 20, 15, 6, 4, 5, 3],
      ['share_link_click', 55, 9, 20, 10, 5, 4],
    ],
    eventChannels: [['listing_shared', 'wa', 12], ['listing_shared', 'ig', 5], ['listing_shared', '', 3], ['share_link_click', 'wa', 40], ['listing_share_opened', 'fb', 2]],
    visitTotals: [[33, 10, 6, 70]],
    visitChannels: [['whatsapp', 25, 50], ['instagram', 8, 20]],
    outcomes: [[4, 2, 1, 3, 1, 0]],
  });
  it('totals and this week vs the week before', () => {
    expect(out.opened).toMatchObject({ range: 40, people: 30, w: 12, p: 8 });
    expect(out.shared).toMatchObject({ range: 20, w: 6, p: 4 });
    expect(out.clicks.range).toBe(55);
    expect(out.visitors).toEqual({ range: 33, w: 10, p: 6, visits: 70 });
    expect(out.contacts).toEqual({ range: 4, w: 2, p: 1 });
    expect(out.signups).toEqual({ range: 3, w: 1, p: 0 });
    expect(out.missing).toEqual([]);
  });
  it('channels merge the share-sheet code with the visit utm_source', () => {
    const by = Object.fromEntries(out.channels.map((c) => [c.code, c]));
    expect(by.wa).toMatchObject({ shared: 12, clicks: 40, visitors: 25, visits: 50, label: 'WhatsApp' });
    expect(by.ig).toMatchObject({ shared: 5, visitors: 8 });
    expect(by.other.shared).toBe(3);
    expect(by.fb.opened).toBe(2);
    expect(out.channels[0].code).toBe('wa');
    expect(by.li).toBeUndefined();   // nothing → not listed
  });
  it('a failed query is named and counts as 0', () => {
    const s = summarizeShares({ eventTotals: null, visitTotals: [[1, 1, 0, 1]] });
    expect(s.shared.range).toBe(0);
    expect(s.visitors.range).toBe(1);
    expect(s.missing).toContain('eventTotals');
  });
});

describe('share rewards (email_log share_reward)', () => {
  const L1 = '11111111-1111-4111-8111-111111111111';
  const rows = [
    { id: 1, channel: 'event', status: 'sent', dedupe_key: `share:reward:${L1}:ev`, run_id: 'u1', to_email: 'a@x.com', created_at: ago(1) },
    { id: 2, channel: 'email', status: 'sent', dedupe_key: `share:reward:${L1}`, run_id: 'u1', created_at: ago(1) },   // its email: not a second grant
    { id: 3, channel: 'event', status: 'sent', dedupe_key: 'share:reward:22222222-2222-4222-8222-222222222222:ev', error: JSON.stringify({ listing_id: 'L-json' }), run_id: 'u2', created_at: ago(9) },
    { id: 4, channel: 'event', status: 'revoked', dedupe_key: 'share:reward:x:ev', created_at: ago(2) },
    { id: 5, channel: 'event', status: 'sent', dedupe_key: 'share:reward:old:ev', created_at: ago(60) },
  ];
  it('counts grants (event rows), this week vs before, in the range', () => {
    const r = summarizeShareRewards(rows, { days: 30, now });
    expect(r).toMatchObject({ total: 3, range: 2, w: 1, p: 1 });
    expect(r.recent[0]).toMatchObject({ userId: 'u1', listingId: L1, email: 'a@x.com' });
    expect(r.recent[1].listingId).toBe('L-json');
  });
  it('a country with only the emails: each sent email is one grant', () => {
    const r = summarizeShareRewards([{ id: 1, channel: 'email', status: 'sent', created_at: ago(1) }, { id: 2, channel: 'email', status: 'failed', created_at: ago(1) }], { days: 7, now });
    expect(r.total).toBe(1);
  });
  it('listingOfReward', () => {
    expect(listingOfReward({ dedupe_key: 'nothing' })).toBeNull();
  });
});

describe('most-shared listings and top sellers', () => {
  const props = [
    { id: 'p1', created_by: 'u1', property_type: 'casa', listing_type: 'sale', neighborhood: 'Villa Morra', feature_image_url: 'img1' },
    { id: 'p2', created_by: 'u1', property_type: 'departamento', listing_type: 'rent', city: 'Asunción' },
    { id: 'p3', created_by: 'u2', property_type: 'terreno' },
  ];
  const users = [{ id: 'u1', email: 'ana@x.com', full_name: 'Ana' }, { id: 'u2', email: 'bo@x.com', full_name: 'Bo', profile_photo_url: 'ph', profile_photo_status: 'approved' }];
  const listingRows = [['p3', 9, 12, 2, 4], ['p1', 5, 6, 30, 2], ['gone', 50, 50, 50, 1], ['p2', 1, 1, 3, 1]];
  const sharerRows = [['ana@x.com', 'p1', 4], ['someone@y.com', 'p1', 1], ['', 'p3', 9], ['ana@x.com', 'p2', 1]];
  it('only listings of this country, with photo, title and owner', () => {
    const l = topListings(listingRows, { props, users });
    expect(l.map((x) => x.id)).toEqual(['p3', 'p1', 'p2']);
    expect(l[1]).toMatchObject({ title: 'Casa for sale · Villa Morra', photo: 'img1', owner: 'Ana', ownerEmail: 'ana@x.com', shares: 5, clicks: 30 });
    expect(listingTitle(props[1])).toBe('Departamento for rent · Asunción');
  });
  it('sellers ranked by the shares they made themselves', () => {
    const s = topSellers(sharerRows, listingRows, { props, users });
    expect(s.map((x) => x.ownerId)).toEqual(['u1', 'u2']);
    expect(s[0]).toMatchObject({ name: 'Ana', ownShares: 5, shares: 6, clicks: 33, listings: 2 });
    expect(s[1]).toMatchObject({ ownShares: 0, shares: 9, photo: 'ph' });
  });
  it('listing ids to look up', () => {
    expect(listingIdsOf(listingRows, sharerRows, [{ listingId: 'r1' }]).sort()).toEqual(['gone', 'p1', 'p2', 'p3', 'r1']);
  });
});

describe('Email & WhatsApp campaigns catalog', () => {
  it('has the two share automations in the Sharing group', () => {
    expect(GROUPS.some((g) => g.key === 'sharing')).toBe(true);
    expect(CATALOG.share_nudge.group).toBe('sharing');
    expect(CATALOG.share_reward.group).toBe('sharing');
  });
});
