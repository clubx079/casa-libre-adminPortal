import { describe, it, expect } from 'vitest';
import { classifyUser, backfillPatch, buildEvidence, guestOwnerId } from '../lib/userTypeBackfill.js';
import { typeOf, TYPE_FILTERS } from '../lib/userTypeAdmin.js';
import { inSellerAudience, userTypeGroup, typeShares } from '../lib/userType.js';

const made = '2026-10-01T12:00:00.000Z';
const NOW = new Date('2026-11-22T00:00:00Z');

describe('backfill: classifyUser (the user rule)', () => {
  it('listed (a listing owned, or a listing email) → seller, first_listed_at = earliest', () => {
    expect(classifyUser({ created_at: made }, { listings: [{ created_at: '2026-10-05T00:00:00Z' }, { created_at: '2026-10-03T00:00:00Z' }] }))
      .toEqual({ type: 'seller', source: 'backfill_listed', first_listed_at: '2026-10-03T00:00:00Z' });
    expect(classifyUser({ created_at: made }, { listedEmails: ['2026-10-09T00:00:00Z'] }).first_listed_at).toBe('2026-10-09T00:00:00Z');
  });
  it('sell-wizard sign-up events up to 15 min after the account was made → seller (sell funnel)', () => {
    expect(classifyUser({ created_at: made }, { sellEvents: ['2026-10-01T11:58:00Z'] }).source).toBe('backfill_sell_funnel');
    expect(classifyUser({ created_at: made }, { sellEvents: ['2026-10-01T12:10:00Z'] }).source).toBe('backfill_sell_funnel');
    // a sell event long after the account existed is not how it was made
    expect(classifyUser({ created_at: made }, { sellEvents: ['2026-10-02T12:00:00Z'] }).type).toBe('buyer');
  });
  it('guest draft under its email → sell funnel; own draft never published → seller (draft)', () => {
    expect(classifyUser({ created_at: made }, { guestDrafts: 1 }).source).toBe('backfill_sell_funnel');
    expect(classifyUser({ created_at: made }, { drafts: 2 }).source).toBe('backfill_draft');
    expect(classifyUser({ created_at: made }, { draftEmails: 1 }).source).toBe('backfill_draft');
  });
  it('no evidence → buyer (made from Log in, never listed)', () => {
    expect(classifyUser({ created_at: made }, {})).toEqual({ type: 'buyer', source: 'backfill_login', first_listed_at: null });
  });
});

describe('backfill: backfillPatch', () => {
  const v = { type: 'seller', source: 'backfill_listed', first_listed_at: '2026-10-03T00:00:00Z' };
  it('types an account with no type, fills first_listed_at', () => {
    expect(backfillPatch({}, v, { now: NOW })).toEqual({ user_type: 'seller', user_type_source: 'backfill_listed', user_type_at: NOW.toISOString(), first_listed_at: v.first_listed_at });
  });
  it('keeps a type already set (only first_listed_at), unless force', () => {
    expect(backfillPatch({ user_type: 'buyer' }, v)).toEqual({ first_listed_at: v.first_listed_at });
    expect(backfillPatch({ user_type: 'buyer', first_listed_at: 'x' }, v)).toBe(null);
    expect(backfillPatch({ user_type: 'buyer' }, v, { force: true, now: NOW }).user_type).toBe('seller');
  });
});

describe('backfill: buildEvidence', () => {
  it('joins listings, drafts (own + guest), emails and PostHog by id and email', () => {
    const users = [{ id: 'u1', email: 'Ana@X.com', created_at: made }, { id: 'u2', email: 'bo@x.com', created_at: made }];
    const ev = buildEvidence({
      users,
      props: [{ created_by: 'u1', created_at: '2026-10-02T00:00:00Z' }],
      drafts: [{ user_id: guestOwnerId('bo@x.com') }, { user_id: 'u1' }],
      emails: [{ to_email: 'ana@x.com', template_key: 'draft-reminder' }, { to_email: 'BO@x.com', template_key: 'event:listing_deleted', created_at: '2026-10-04T00:00:00Z' }],
      phEvents: [{ email: 'ana@x.com', event: 'sell_otp_sent', ts: made }, { distinct_id: 'u2', event: 'sell_otp_verified', ts: made }, { email: 'bo@x.com', event: 'user_signed_up', ts: made }],
    });
    expect(ev.get('u1')).toMatchObject({ drafts: 1, guestDrafts: 0, draftEmails: 1, sellEvents: [made] });
    expect(ev.get('u1').listings).toHaveLength(1);
    expect(ev.get('u2')).toMatchObject({ guestDrafts: 1, listedEmails: ['2026-10-04T00:00:00Z'], sellEvents: [made] });
  });
  it('guestOwnerId is the website one (v5 uuid of the email, case-insensitive)', () => {
    expect(guestOwnerId('Ana@x.com')).toBe('909ebd61-5fae-5781-b6a4-ebff58b16619');
    expect(guestOwnerId(' ana@x.com ')).toBe(guestOwnerId('ANA@X.COM'));
  });
});

describe('admin Type column', () => {
  it('typeOf: group from the type + listed (first_listed_at or a listing owned)', () => {
    expect(typeOf({ id: 'a', user_type: 'seller' })).toMatchObject({ group: 'seller_never_listed', listed: false });
    expect(typeOf({ id: 'a', user_type: 'seller' }, new Map([['a', 1]]))).toMatchObject({ group: 'seller_listed', listed: true });
    expect(typeOf({ id: 'b', user_type: 'buyer', first_listed_at: made, user_type_source: 'signup_choice' })).toMatchObject({ group: 'buyer_listed', source: 'signup_choice' });
    expect(typeOf({ id: 'c' }).group).toBe('unknown');
  });
  it('filters cover every group', () => {
    const groups = new Set(Object.values(TYPE_FILTERS).flat());
    expect([...groups].sort()).toEqual(['buyer', 'buyer_listed', 'seller_listed', 'seller_never_listed', 'unknown']);
  });
  it('shares + seller audience (the shared helper)', () => {
    const s = typeShares([userTypeGroup({ user_type: 'seller' }), userTypeGroup({ user_type: 'buyer' }), 'unknown']);
    expect(s).toMatchObject({ pctSellers: 50, pctBuyers: 50, pctSellersNeverListed: 100 });
    expect(inSellerAudience({ user_type: 'buyer' })).toBe(false);
    expect(inSellerAudience({})).toBe(true);
  });
});
