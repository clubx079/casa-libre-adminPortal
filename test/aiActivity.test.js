// The Inbox assistant's "recent activity" block (lib/aiActivity.js), on fixtures modelled on a
// real case (11 Nov 2026): a seller opened Edit for his listing from the Android app, picked
// photos, tapped the paid plan boxes and "Guardar cambios" — the edit SAVED (6 new photos) and
// the payment screen opened — then wrote "No me deja alzar más foto me quieren cobrar".
import { describe, it, expect, vi } from 'vitest';
import { buildRecentActivity, eventLine, activityQuery, rowsToEvents, loadPersonEvents, listingEdits, ago, when, MAX_LINES, MAX_LINE, ACTIVITY_COLS, TRACKING_SLOW, TRACKING_DOWN } from '../lib/aiActivity.js';
import { buildFactSheet } from '../lib/aiFacts.js';
import { systemPrompt } from '../lib/aiPrompt.js';

const NOW = Date.parse('2026-11-11T13:15:00Z');
const UID = 'b652cc9b-6aea-4eca-8a1e-dc4f1d3a4317';
const PID = '6cebdae8-0fd2-4a79-af1c-b3dc499c04aa';
const EDIT_URL = `https://casa-libre.com.py/cuenta/publicaciones?edit=${PID}&utm_source=mobile_app`;
const web = (at, event, extra = {}) => ({ at, event, lib: 'web', os: 'Android', path: '/cuenta/publicaciones', url: EDIT_URL, ...extra });
const app = (at, event, extra = {}) => ({ at, event, lib: 'posthog-react-native', os: 'Android', app_version: '1.4.0', ...extra });
const tap = (at, label) => web(at, '$autocapture', { label, click: 'click' });

// newest first, as the query returns them (PostHog timestamps have no zone: they are UTC)
const EVENTS = [
  app('2026-11-11 13:13:13.000000', 'Application Backgrounded'),
  app('2026-11-11 13:13:12.000000', '$screen', { path: '/account' }),
  web('2026-11-11 13:13:12.000000', '$pageleave'),
  tap('2026-11-11 13:12:54.000000', 'Guardar cambios'),
  web('2026-11-11 13:12:51.000000', '$autocapture', { label: '', click: 'click' }),
  tap('2026-11-11 13:12:46.000000', 'Insignia Verificada en el marketplace US$5 · 30 días'),
  tap('2026-11-11 13:12:44.000000', 'Recomendado Mostrá tu propiedad en la portada con la insignia Verificada US$20 · 30 días'),
  tap('2026-11-11 13:12:40.000000', 'Guardar cambios'),
  tap('2026-11-11 13:12:37.000000', 'Siguiente'),
  tap('2026-11-11 13:12:36.500000', 'Recomendado Mostrá tu propiedad en la portada con la insignia Verificada US$20 · 30 días'),
  tap('2026-11-11 13:12:36.200000', 'Guardar cambios'),
  tap('2026-11-11 13:12:36.000000', 'Insignia Verificada en el marketplace US$5 · 30 días'),
  web('2026-11-11 13:12:35.000000', '$autocapture', { label: '', click: 'change' }),
  tap('2026-11-11 13:11:48.000000', '1 foto seleccionada'),
  web('2026-11-11 13:11:44.000000', 'listing_edit_opened', { property_id: PID }),
  web('2026-11-11 13:11:42.000000', '$pageview'),
  app('2026-11-11 13:11:41.000000', 'edit_tapped', { property_id: PID }),
  app('2026-11-11 13:11:30.000000', 'property_viewed', { property_id: PID }),
  app('2026-11-11 13:11:23.000000', 'search_applied'),
  { at: '2026-11-11 13:11:22.000000', event: 'app_opened', lib: null, os: null, app_version: '1.4.0' },
  app('2026-11-11 13:11:21.000000', 'Application Opened'),
  web('2026-11-10 11:31:44.000000', 'app_promo_shown', { path: '/' }),
  web('2026-11-10 11:31:43.000000', '$pageview', { path: '/', url: 'https://casa-libre.com.py/' }),
];
const LISTINGS = [
  { id: PID, slug: 'casa-posta-ybycua-mvy0qjqj', status: 'published', admin_status: 'active', is_complete: true, property_type: 'Casa', listing_type: 'sale', neighborhood: 'Loma Barrero', city: 'Capiatá', price: 360000000, currency: 'PYG', created_at: '2026-11-01T16:02:31Z', promotion_plan: null, promotion_expires_at: null,
    raw_data: { edits: [
      { at: '2026-11-06T11:19:24.047Z', by: 'team', note: 'Owner asked on WhatsApp (Nov 6): Loma Barrero', fields: ['neighborhood', 'address', 'latitude', 'longitude'] },
      { at: '2026-11-11T13:13:11.785Z', fields: ['price_usd'], new_photos: 6, removed_photos: 0 },
    ] } },
  { id: 'd915908a-064a-4b65-ae3f-912c8ff74115', slug: 'casa-barrio-san-jose', status: 'published', admin_status: 'active', is_complete: true, property_type: 'Casa', listing_type: 'sale', neighborhood: 'Barrio San Pedro', city: 'Encarnación', created_at: '2026-11-01T15:58:52Z', raw_data: {} },
];
const nameOf = (p) => `house · ${p.neighborhood}`;
const USER = { id: UID, full_name: 'Daniel Famoso', email: 'daniel@example.com', created_at: '2026-10-15T12:10:16Z', auth_provider: 'email', phone_verified_at: '2026-10-15T12:11:00Z' };
const PAYMENTS = [{ kind: 'listing_free', plan: null, amount_usd: 0, status: 'free', property_id: PID, created_at: '2026-11-01T16:02:32Z' }];

describe('recent activity lines', () => {
  const block = buildRecentActivity({ events: EVENTS, listings: LISTINGS, nameOf, now: NOW });
  const text = block.lines.join('\n');

  it('tells the story in order, newest first, in words', () => {
    expect(block.lines[0]).toBe('2 min ago · our records · their edit of house · Loma Barrero was SAVED in our records: 6 photos ADDED; changed: price');
    expect(block.lines[1]).toBe('2 min ago · website, Android · pressed "Guardar cambios" (save)');
    expect(text).toMatch(/tapped a PAID optional extra: "Insignia Verificada en el marketplace US\$5 · 30 días"/);
    expect(text).toMatch(/tapped a PAID optional extra: "Recomendado Mostrá tu propiedad en la portada con la insignia Verificada US\$20 · 30 días"/);
    expect(text).toMatch(/chose photos to upload \("1 foto seleccionada"\)/);
    expect(text).toMatch(/3 min ago · website, Android · the edit form opened for house · Loma Barrero/);
    expect(text).toMatch(/3 min ago · app, Android · tapped "Editar" on house · Loma Barrero in the app/);
    expect(text).toMatch(/app, Android · looked at their own listing house · Loma Barrero/);
    expect(text).toMatch(/4 min ago · app, Android · opened the app \(×2\)/);   // the two "app opened" events are one line
    expect(block.lines[block.lines.length - 1]).toMatch(/^5 days ago · our records · the Casa-Libre team edited house · Loma Barrero \(changed: neighbourhood, address, map pin\)/);
    // order: saved ← save pressed ← paid option ← photos chosen ← form opened ← Edit tapped
    const pos = (re) => block.lines.findIndex((l) => re.test(l));
    expect(pos(/SAVED in our records/)).toBeLessThan(pos(/PAID optional extra/));
    expect(pos(/PAID optional extra/)).toBeLessThan(pos(/chose photos/));
    expect(pos(/chose photos/)).toBeLessThan(pos(/edit form opened/));
  });

  it('drops the noise and never shows a raw event name', () => {
    expect(block.lines).toHaveLength(14);
    for (const noise of ['$pageleave', '$screen', '$autocapture', '$pageview', 'Application', 'search_applied', 'app_promo', 'edit_tapped', 'listing_edit_opened', 'Siguiente', 'property_viewed', 'posthog']) expect(text).not.toContain(noise);
  });

  it('single events: allow-list only', () => {
    expect(eventLine({ event: 'some_new_event_nobody_mapped' })).toBe(null);
    expect(eventLine({ event: '$autocapture', label: 'Ver más', path: '/propiedad/abc' })).toBe(null);            // browsing taps
    expect(eventLine({ event: '$autocapture', label: '›', path: '/cuenta/publicaciones' })).toBe(null);
    expect(eventLine({ event: '$rageclick', label: 'Guardar cambios', path: '/cuenta/publicaciones' })).toBe('pressed "Guardar cambios" (save) several times in a row');
    expect(eventLine({ event: 'listing_edited', property_id: PID, outcome: 'checking', new_photos: 2 }, () => 'house · X')).toMatch(/SAVED — the new photos are in the automatic photo check.*\(2 new photos\)/);
    expect(eventLine({ event: 'payment_screen_opened', property_id: PID, kind: 'verified' }, () => 'house · X')).toMatch(/payment screen opened for house · X \(verified\) — nothing is charged unless/);
    expect(eventLine({ event: '$exception', error: 'Failed to fetch' })).toBe('an ERROR appeared on the page: "Failed to fetch"');
    expect(eventLine({ event: '$pageview', path: '/cuenta/publicaciones', url: `https://x/cuenta/publicaciones?pay_listing=${PID}` }, () => 'house · X')).toBe('opened the payment page for house · X');
    expect(eventLine({ event: 'property_viewed', property_id: 'someone-elses' }, (id, own) => (own ? '' : 'a listing'))).toBe(null);
  });

  it('a save reported by both the site and our records is one line (ours, with the details)', () => {
    const b = buildRecentActivity({ events: [web('2026-11-11 13:13:12.000000', 'listing_edited', { property_id: PID, outcome: 'checking', new_photos: 6 })], listings: LISTINGS, nameOf, now: NOW });
    expect(b.lines.filter((l) => /their edit of/.test(l))).toHaveLength(1);
    expect(b.lines[0]).toMatch(/our records/);
  });

  it('caps hold: at most MAX_LINES lines of MAX_LINE characters, newest kept', () => {
    const many = Array.from({ length: 300 }, (_, i) => tap(new Date(NOW - i * 61_000).toISOString(), `Botón número ${i} ${'x'.repeat(200)}`));
    const b = buildRecentActivity({ events: many, listings: [], nameOf, now: NOW });
    expect(b.lines).toHaveLength(MAX_LINES);
    expect(Math.max(...b.lines.map((l) => l.length))).toBeLessThanOrEqual(MAX_LINE);
    expect(b.lines[0]).toMatch(/^just now/);
    expect(b.older_lines_left_out).toBe(300 - MAX_LINES);
    expect(JSON.stringify(b).length).toBeLessThan(6500);   // ≈ 1.5 k tokens at most
  });

  it('events older than the window are left out; nothing at all → null', () => {
    expect(buildRecentActivity({ events: [tap('2026-11-08 10:00:00.000000', 'Guardar cambios')], listings: [], nameOf, now: NOW })).toBe(null);
    expect(buildRecentActivity({ events: [], listings: [], nameOf, now: NOW })).toBe(null);
  });

  it('times and the per-listing edit log', () => {
    expect(ago(NOW - 20_000, NOW)).toBe('just now');
    expect(ago(NOW - 5 * 3600_000, NOW)).toBe('5 h ago');
    expect(when('2026-11-11 13:12:36.123000')).toBe(Date.parse('2026-11-11T13:12:36.123Z'));
    expect(listingEdits(LISTINGS[0], NOW)).toEqual(['2 min ago: 6 photos added, changed price', '5 days ago (by our team): changed neighbourhood, address, map pin']);
  });
});

describe('the PostHog query', () => {
  it('asks for this one person only (id or email), 48 h, noise out, capped', () => {
    const q = activityQuery({ userId: UID, email: 'Daniel@Example.com' });
    expect(q).toContain(`distinct_id = '${UID}'`);
    expect(q).toContain("lower(person.properties.email) = 'daniel@example.com'");
    expect(q).toContain('INTERVAL 48 HOUR');
    expect(q).toContain("'$pageleave'");
    expect(q).toMatch(/LIMIT 400$/);
  });
  it('never puts unsafe text into the query', () => {
    expect(activityQuery({ userId: "x' OR 1=1 --", email: "a'b@c.com" })).toBe(null);
    expect(activityQuery({})).toBe(null);
    expect(activityQuery({ userId: "'; DROP", email: 'ok@example.com' })).not.toContain('DROP');
  });
  it('rows map to named fields', () => {
    const row = ['2026-11-11 13:12:54', '$autocapture', 'web', 'Android', '/cuenta/publicaciones', EDIT_URL, 'Guardar cambios', 'click', null, null, null, null, null, null, null, null];
    expect(row).toHaveLength(ACTIVITY_COLS.length);
    expect(rowsToEvents([row])[0]).toMatchObject({ at: '2026-11-11 13:12:54', event: '$autocapture', label: 'Guardar cambios', os: 'Android' });
  });
});

describe('PostHog slow or down never blocks the reply', () => {
  it('a failure → no events, a note, no throw', async () => {
    const r = await loadPersonEvents({ userId: UID, email: USER.email, run: async () => { throw new Error('PostHog 500'); } });
    expect(r).toEqual({ events: null, tracking: TRACKING_DOWN });
  });
  it('a query slower than the timeout → answered without it', async () => {
    vi.useFakeTimers();
    try {
      const p = loadPersonEvents({ userId: UID, email: USER.email, timeoutMs: 4000, run: () => new Promise(() => {}) });
      await vi.advanceTimersByTimeAsync(4001);
      expect(await p).toEqual({ events: null, tracking: TRACKING_SLOW });
    } finally { vi.useRealTimers(); }
  });
  it('a quick answer is used', async () => {
    const run = vi.fn(async () => [['2026-11-11 13:12:54', '$autocapture', 'web', 'Android', '/cuenta/publicaciones', EDIT_URL, 'Guardar cambios', 'click']]);
    const r = await loadPersonEvents({ userId: UID, email: USER.email, run });
    expect(r.tracking).toBe('ok');
    expect(r.events[0].label).toBe('Guardar cambios');
    expect(run.mock.calls[0][0]).toContain(UID);
  });
  it('no PostHog configured → the same', async () => {
    expect((await loadPersonEvents({ userId: UID, email: USER.email, run: null })).events).toBe(null);
  });
});

describe('fact sheet with the activity', () => {
  const base = { cc: 'py', countryName: 'Paraguay', site: 'https://casa-libre.com.py', now: new Date(NOW), user: USER, listings: LISTINGS, payments: PAYMENTS, photoCounts: new Map([[PID, 7]]) };

  it('the listing row says what is on it now, and the activity says what happened', () => {
    const f = buildFactSheet({ ...base, personEvents: EVENTS });
    expect(f.listings[0]).toMatchObject({ what: 'house · for sale · Loma Barrero', state: 'LIVE on the site', photos_on_it_now: 7, promotion: 'none (no Verified badge, not on the home page)' });
    expect(f.listings[0].saved_edits[0]).toBe('2 min ago: 6 photos added, changed price');
    expect(f.recent_activity.lines.length).toBeGreaterThan(8);
    expect(f.recent_activity.charged_last_7_days).toBe('nothing — no charge was made');
    expect(f.recent_activity.click_tracking).toBeUndefined();
  });

  it('PostHog failed → the sheet is still built, with what our records show', () => {
    const f = buildFactSheet({ ...base, personEvents: null, tracking: TRACKING_DOWN });
    expect(f.recent_activity.lines).toEqual([
      '2 min ago · our records · their edit of house · Loma Barrero was SAVED in our records: 6 photos ADDED; changed: price',
      expect.stringMatching(/^5 days ago · our records · the Casa-Libre team edited/),
    ]);
    expect(f.recent_activity.click_tracking).toBe(TRACKING_DOWN);
    expect(f.listings[0].photos_on_it_now).toBe(7);
    expect(f.recent_activity.charged_last_7_days).toMatch(/nothing/);
  });

  it('a real charge and an unfinished payment are told apart', () => {
    const f = buildFactSheet({ ...base, personEvents: [], payments: [
      { kind: 'highlight', plan: 'verified', amount_usd: 5, status: 'succeeded', property_id: PID, created_at: '2026-11-10T10:00:00Z' },
      { kind: 'highlight', plan: 'home', amount_usd: 20, status: 'started', property_id: PID, created_at: '2026-11-11T13:13:00Z' },
      { kind: 'listing', amount_usd: 5.8, status: 'succeeded', property_id: PID, created_at: '2026-09-01T10:00:00Z' },
    ] });
    expect(f.recent_activity.charged_last_7_days).toEqual(['US$5.00 on 2026-11-10 — promotion (verified) — house · Loma Barrero']);
    expect(f.recent_activity.payment_screens_opened_but_not_paid).toEqual(['US$20.00 on 2026-11-11 — promotion (home) — house · Loma Barrero']);
    expect(f.payments[1].status).toBe('payment screen opened, NOT paid');
  });

  it('an active promotion shows on the listing; no account → no activity block', () => {
    const f = buildFactSheet({ ...base, listings: [{ ...LISTINGS[0], promotion_plan: 'home', promotion_expires_at: '2026-12-01T00:00:00Z' }] });
    expect(f.listings[0].promotion).toBe('home page display + Verified badge until 2026-12-01');
    expect(buildFactSheet({ ...base, user: null, listings: [], payments: [] }).recent_activity).toBeUndefined();
  });

  it('the whole block stays small', () => {
    const f = buildFactSheet({ ...base, personEvents: EVENTS });
    expect(JSON.stringify(f.recent_activity).length).toBeLessThan(2500);
  });
});

describe('the prompt tells the assistant how to use it, and keeps the old rules', () => {
  const p = systemPrompt('Paraguay');
  it('use the activity, never invent it, no raw names', () => {
    expect(p).toMatch(/recent_activity/);
    expect(p).toMatch(/NEVER invent an action, a save, a charge/);
    expect(p).toMatch(/never quote technical names/);
    expect(p).toMatch(/their changes are SAVED first and then the payment screen/);
  });
  it('existing rules are still there', () => {
    expect(p).toMatch(/Never state a specific view or contact number for THEIR listing that is not in the fact sheet/);
    expect(p).toMatch(/NO emojis, ever/);
    expect(p).toMatch(/We never justify ourselves/);
    expect(p).toMatch(/never promise gifts, discounts or refunds/);
  });
});
