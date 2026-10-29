import { describe, it, expect } from 'vitest';
import { isUnread, isUnresponded, dncOf, dncTagPatch, visibleTags, formatPhone, filterConversations, countryCounts, threadForAi, UNREAD_TAG, sitesOf } from '../lib/inboxRules.js';
import { paywallState, paywallRows, paywallEvents, nthOfMonth, remindersByListing, ordinal } from '../lib/paywallActivity.js';
import { validatePaymentFollowup, paymentFollowupConfig, paymentFollowupCounts, DEFAULT_STEPS } from '../lib/paymentFollowupAdmin.js';

const PREFIX = { py: '595', bo: '591', uy: '598', ve: '58', sv: '503' };
const conv = (o) => ({ phone: '+595981000001', status: 'open', tags: [], unread_count: 0, last_message: { direction: 'outbound' }, ...o });

describe('inbox rules', () => {
  it('unread = new messages or marked unread; unresponded = they wrote last', () => {
    expect(isUnread(conv({ unread_count: 2 }))).toBe(true);
    expect(isUnread(conv({ tags: [UNREAD_TAG] }))).toBe(true);
    expect(isUnread(conv())).toBe(false);
    expect(isUnresponded(conv({ last_message: { direction: 'inbound' } }))).toBe(true);
    expect(isUnresponded(conv())).toBe(false);
  });
  it('do not contact: tags in, note out, internal tags hidden', () => {
    const c = conv({ tags: ['hot lead', 'do-not-contact', 'dnc: rude, asked to stop', UNREAD_TAG] });
    expect(dncOf(c)).toEqual({ note: 'rude, asked to stop' });
    expect(dncOf(conv({ tags: ['do-not-contact', 'dnc:-rude-asked-to-stop'] }))).toEqual({ note: 'rude asked to stop' });   // as Relay stores it
    expect(dncOf(conv({ tags: ['hot lead'] }))).toBe(null);
    expect(visibleTags(c.tags)).toEqual(['hot lead']);
    const on = dncTagPatch(conv({ tags: ['dnc:-old'] }), true, '  a very long note that keeps going past the forty character limit  ');
    expect(on.add_tags[0]).toBe('do-not-contact');
    expect(on.add_tags[1].length).toBeLessThanOrEqual(40);
    expect(on.remove_tags).toEqual(['dnc:-old']);
    expect(on.add_tags[1].startsWith('dnc: a very long note')).toBe(true);
    expect(dncTagPatch(c, false)).toEqual({ remove_tags: ['do-not-contact', 'dnc: rude, asked to stop'] });
  });
  it('formats numbers by calling code', () => {
    expect(formatPhone('+595981123456')).toBe('+595 981 123 456');
    expect(formatPhone('59171234567')).toBe('+591 7123 4567');
    expect(formatPhone('+15551234567')).toBe('+1 555 123 4567');
    expect(formatPhone('+584121234567')).toBe('+58 412 123 4567');
    expect(formatPhone('+923362771289')).toBe('+92 336 277 1289');
  });
  it('places a conversation by the site that sent its code, never by the calling code', () => {
    expect(sitesOf(conv({ phone: '+595981000001', tags: ['site-bo'] }))).toEqual(['bo']);           // a Paraguayan number used on the Bolivia site
    expect(sitesOf(conv({ tags: ['site-py', 'hot-lead', 'site-uy'] }))).toEqual(['py', 'uy']);  // two sites → both inboxes
    expect(visibleTags(['site-py', 'hot-lead'])).toEqual(['hot-lead']);
    // untagged (older) chats: the country DBs that know the number (any format)
    expect(sitesOf(conv({ phone: '+595981777123' }), new Map([['81777123', ['ve']]]))).toEqual(['ve']);
    expect(sitesOf(conv({ phone: '+595981777123' }), new Map())).toEqual(['none']);
    expect(sitesOf(conv({ phone: '+59171234567' }))).toEqual(['none']);                      // no country-code guess
  });
  it('a number on two sites counts in both', () => {
    const two = [conv({ sites: ['py', 'bo'], unread_count: 1 })];
    expect(filterConversations(two, { country: 'bo' }).data).toHaveLength(1);
    expect(filterConversations(two, { country: 'py' }).data).toHaveLength(1);
    expect(countryCounts(two)).toEqual({ py: { total: 1, unread: 1, unresponded: 0 }, bo: { total: 1, unread: 1, unresponded: 0 } });
  });
  it('filters by country / status / view and counts', () => {
    const list = [
      conv({ phone: '+595981000001', country: 'py', unread_count: 1, last_message: { direction: 'inbound' } }),
      conv({ phone: '+595981000002', country: 'py', tags: [UNREAD_TAG] }),
      conv({ phone: '+595981000003', country: 'py', status: 'done', last_message: { direction: 'inbound' } }),
      conv({ phone: '+59171234567', country: 'bo', last_message: { direction: 'inbound' } }),
    ];
    const py = filterConversations(list, { country: 'py' });
    expect(py.data.map((c) => c.phone)).toEqual(['+595981000001', '+595981000002']);
    expect(py.counts).toEqual({ open: 2, done: 1, unread: 2, unresponded: 1 });
    expect(filterConversations(list, { country: 'py', view: 'unresponded', status: 'all' }).data).toHaveLength(2);
    expect(filterConversations(list, { country: 'all', view: 'unresponded' }).data).toHaveLength(2);
    expect(filterConversations(list, { country: 'all', q: '1234567' }).data.map((c) => c.country)).toEqual(['bo']);
    expect(countryCounts(list)).toEqual({ py: { total: 3, unread: 2, unresponded: 1 }, bo: { total: 1, unread: 0, unresponded: 1 } });
  });
  it('the thread for the AI reply, oldest first', () => {
    const t = threadForAi([{ direction: 'outbound', template: { name: 'cl_borrador' }, text: 'Hola', created_at: '2026-10-28T10:00:00Z' }, { direction: 'inbound', text: 'Nadie me llama', created_at: '2026-10-28T11:00:00Z' }]);
    expect(t).toContain('CASA LIBRE (automatic template cl_borrador): Hola');
    expect(t.split('\n')[1]).toContain('CONTACT: Nadie me llama');
  });
});

describe('paywall activity', () => {
  const now = new Date('2026-10-29T15:00:00Z');
  const L = (id, created_at, status, pl, by = 'u1') => ({ id, created_by: by, created_at, status, property_type: 'casa', listing_type: 'sale', city: 'Luque', raw_data: pl ? { paid_listing: pl } : {} });
  const listings = [
    L('a', '2026-10-02T12:00:00Z', 'published', null),
    L('b', '2026-10-05T12:00:00Z', 'published', null),
    L('c', '2026-10-20T12:00:00Z', 'payment_pending', { state: 'pending', price_cents: 580 }),
    L('d', '2026-10-21T12:00:00Z', 'published', { state: 'active', price_cents: 580, paid_at: '2026-10-21T15:00:00Z' }),
    L('e', '2026-10-22T12:00:00Z', 'scanning', { state: 'active', gift: { offered_at: '2026-10-28T12:00:00Z', expires_at: '2026-11-11T12:00:00Z', claimed_at: '2026-10-29T10:00:00Z' } }),
    L('f', '2026-10-23T12:00:00Z', 'payment_pending', { state: 'pending', gift: { offered_at: '2026-10-28T12:00:00Z', expires_at: '2026-11-11T12:00:00Z' } }),
  ];
  it('states', () => {
    expect(listings.slice(2).map((p) => paywallState(p, now))).toEqual(['waiting', 'paid', 'gift_taken', 'gift_open']);
    expect(paywallState(L('x', '2026-09-01T00:00:00Z', 'payment_pending', { gift: { offered_at: '2026-09-09T00:00:00Z', expires_at: '2026-09-23T00:00:00Z' } }), now)).toBe('gift_lapsed');
  });
  it('rows: nth listing of the month, tried to pay, reminders', () => {
    const rows = paywallRows({ listings, payments: [{ property_id: 'c', status: 'started', created_at: '2026-10-20T12:05:00Z' }], reminders: remindersByListing([{ dedupe_key: 'payrem:c:1' }, { dedupe_key: 'held:c:payment:1' }, { dedupe_key: 'paygift:f' }]), cc: 'py', now });
    expect(rows.map((r) => r.id)).toEqual(['f', 'e', 'd', 'c']);
    const c = rows.find((r) => r.id === 'c');
    expect(c).toMatchObject({ nth: 3, state: 'waiting', triedToPay: true, reminders: 2, price: 'US$5.80' });
    expect(rows.find((r) => r.id === 'd')).toMatchObject({ nth: 4, state: 'paid', paidAfterH: 3 });
    expect(nthOfMonth(listings[0], listings)).toBe(1);
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(11)).toBe('11th');
  });
  it('events read like a story', () => {
    const [c] = paywallRows({ listings: listings.slice(0, 3), cc: 'py', now });
    const ev = paywallEvents(c);
    expect(ev[0].title).toBe('Wanted to publish their 3rd listing this month — the payment step came up (US$5.80)');
    expect(ev[0].detail).toContain('likely didn\'t want to pay');
    const [e] = paywallRows({ listings: listings.slice(0, 5).filter((p) => p.id !== 'c' && p.id !== 'd'), cc: 'py', now });
    expect(paywallEvents(e).map((x) => x.kind)).toEqual(['gift_taken', 'gift', 'paywall']);
  });
});

describe('Waiting for payment → free listing settings', () => {
  it('defaults before the first save', () => {
    const c = paymentFollowupConfig(null);
    expect(c).toMatchObject({ enabled: false, steps: DEFAULT_STEPS, giftAfterDays: 8, giftsPerPerson: 1, giftWindowDays: 0, giftDays: 90 });
  });
  it('validates', () => {
    const ok = validatePaymentFollowup({ steps: [24, 72, 168], giftAfterDays: 8, giftsPerPerson: 1, giftWindowDays: 0, giftDays: 90, reminderTemplateId: 'r', giftTemplateId: 'g', enabled: true }, null, 'NOW');
    expect(ok.ok).toBe(true);
    expect(ok.value).toMatchObject({ milestones: [24, 72, 168], wait_days: 8, first_tier_count: 1, free_tiers: [{ gift_window_days: 0 }], free_days: 90, template_id: 'r', gift_template_id: 'g', enabled: true, enabled_at: 'NOW' });
    expect(validatePaymentFollowup({ steps: [24, 72, 168], giftAfterDays: 5, reminderTemplateId: 'r', giftTemplateId: 'g' }).errors.giftAfterDays).toMatch(/after the last reminder/);
    expect(validatePaymentFollowup({ steps: [24], giftAfterDays: 3, reminderTemplateId: 'r', giftTemplateId: '' }).errors.giftTemplateId).toBeTruthy();
    expect(validatePaymentFollowup({ steps: [24], giftAfterDays: 0, reminderTemplateId: 'r' }).ok).toBe(true);   // no gift
    expect(validatePaymentFollowup({ steps: [9999] }).errors.steps).toBeTruthy();
    expect(validatePaymentFollowup({ giftWindowDays: 45 }).errors.giftWindowDays).toBeTruthy();
    expect(validatePaymentFollowup({ enabled: true, steps: [24], giftAfterDays: 0, reminderTemplateId: '' }).errors.enabled).toBeTruthy();
  });
  it('counts reminders and gifts from the log', () => {
    expect(paymentFollowupCounts([{ dedupe_key: 'payrem:a:1' }, { dedupe_key: 'payrem:a:2' }, { dedupe_key: 'payrem:b:1' }, { dedupe_key: 'paygift:a' }, { dedupe_key: 'held:a:payment:1' }]))
      .toEqual({ perStep: { 1: 2, 2: 1 }, reminders: 3, gifts: 1 });
  });
});

describe('Users page listing count', async () => {
  const { countListings } = await import('../lib/listingCount.js');
  it('counts only published listings; waiting for payment is counted apart', () => {
    const { published, waiting } = countListings([
      { created_by: 'm', status: 'published' }, { created_by: 'm', status: 'published' }, { created_by: 'm', status: 'payment_pending' },
      { created_by: 'x', status: 'scanning' }, { created_by: 'x', status: 'rejected' }, { created_by: 'x', status: 'duplicate_review' }, { created_by: 'x', status: 'expired' },
    ]);
    expect(published.get('m')).toBe(2);
    expect(waiting.get('m')).toBe(1);
    expect(published.get('x')).toBe(1);   // only the ended (expired) one was ever on the site
  });
});

describe('PostHog payment events in the timeline', async () => {
  const { posthogPaymentSteps } = await import('../lib/paywallActivity.js');
  it('maps the website payment events to steps', () => {
    const steps = posthogPaymentSteps([
      ['2026-10-29 15:00:00', 'payment_screen_opened', 'p3', 'publish', null, null],
      ['2026-10-29 15:01:00', 'payment_started', 'p3', 'publish', null, null],
      ['2026-10-30 10:00:00', 'listing_gift_failed', 'p3', null, 'email', 'expired'],
      ['2026-10-30 10:00:00', 'pageview', null, null, null, null],
    ], (pid) => (pid === 'p3' ? 'Casa · sale · Luque' : ''));
    expect(steps.map((s) => s.kind)).toEqual(['ph_opened', 'ph_started', 'ph_gift_failed']);
    expect(steps[0]).toMatchObject({ at: '2026-10-29T15:00:00', title: 'Opened the pay screen to publish a listing', detail: 'Casa · sale · Luque · PostHog.' });
    expect(steps[2].detail).toBe('Casa · sale · Luque · from the gift email · reason: expired · PostHog.');
  });
});
