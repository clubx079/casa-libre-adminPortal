import { describe, it, expect } from 'vitest';
import { newCheckouts, firstPayDraft, payKind, payThreads, unpaidKind, payLabel } from '../lib/manager/payFollowups.js';
import { dailyDrafts } from '../lib/manager/dailyDrafts.js';

const U = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const H = 3600e3, DAY = 24 * H;
const NOW = Date.parse('2026-11-05T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const st = (ago, extra = {}) => ({ user_id: U, property_id: P, kind: 'highlight', plan: 'verified', status: 'started', amount_usd: 5, created_at: iso(NOW - ago), ...extra });
const live = new Map([[P, { id: P, status: 'published', property_type: 'Casa', neighborhood: 'Ybapobo' }]]);

describe('daily: the first payment email', () => {
  it('picks checkouts 2 h – 14 days old, not paid, not bought another way, without an email yet', () => {
    expect(newCheckouts({ payments: [st(3 * H)], listingsById: live, now: NOW })).toMatchObject([{ key: `${U}:${P}`, plan: 'verified' }]);
    expect(newCheckouts({ payments: [st(30 * 60e3)], listingsById: live, now: NOW })).toEqual([]);   // may still be paying
    expect(newCheckouts({ payments: [st(20 * DAY)], listingsById: live, now: NOW })).toEqual([]);   // too old
    expect(newCheckouts({ payments: [st(3 * H)], threadKeys: new Set([`${U}:${P}`]), listingsById: live, now: NOW })).toEqual([]);   // already emailed
    expect(newCheckouts({ payments: [st(3 * H), st(H, { status: 'succeeded' })], listingsById: live, now: NOW })).toEqual([]);   // paid after
    expect(newCheckouts({ payments: [st(3 * H)], listingsById: new Map([[P, { status: 'published', promoted_at: iso(NOW - H) }]]), now: NOW })).toEqual([]);
    expect(newCheckouts({ payments: [st(3 * H)], listingsById: new Map(), now: NOW })).toEqual([]);   // listing gone
    // an extra listing: only while it is still waiting for payment
    const pend = new Map([[P, { status: 'payment_pending' }]]);
    expect(newCheckouts({ payments: [st(3 * H, { kind: 'listing', plan: null })], listingsById: pend, now: NOW })).toMatchObject([{ plan: 'listing' }]);
    expect(newCheckouts({ payments: [st(3 * H, { kind: 'listing', plan: null })], listingsById: live, now: NOW })).toEqual([]);
    // two checkouts for one listing → one email (the latest)
    expect(newCheckouts({ payments: [st(5 * H, { plan: 'home' }), st(3 * H)], listingsById: live, now: NOW })).toMatchObject([{ plan: 'verified' }]);
  });

  it('writes the email like the Manager does, with the button that opens that payment', () => {
    const [c] = newCheckouts({ payments: [st(3 * H)], listingsById: live, now: NOW });
    const d = firstPayDraft(c, { listing: live.get(P), user: { full_name: 'DERLIS LOPEZ' }, site: 'https://casa-libre.com.py' });
    expect(d).toMatchObject({ kind: 'unpaid_listing', plan: 'verified', followup: 0, subject: '¿Te ayudamos con el sello Verificado?', heading: 'Tu casa en Ybapobo', button_label: 'Agregar el sello Verificado' });
    expect(d.body).toMatch(/^Hola Derlis,/);
    expect(d.body).toMatch(/Vimos que el 5 de noviembre empezaste a agregar el sello \*\*Verificado\*\*/);
    expect(d.body).toMatch(/Tu publicación sigue activa y visible/);
    expect(d.button_url).toBe(`https://casa-libre.com.py/cuenta/publicaciones?pay=${P}&plan=verified`);
    const ext = firstPayDraft({ ...c, plan: 'extend' }, { listing: live.get(P), user: {}, site: 'https://x.py' });
    expect(ext.button_url).toBe(`https://x.py/cuenta/publicaciones?extend=${P}`);
    expect(ext.body).not.toMatch(/sigue activa/);
  });

  it('a listing extension is its own kind, with its own name', () => {
    expect(payKind({ user_id: U, property_id: P, sends: [{ button_url: 'https://x.py/cuenta/publicaciones?extend=abc' }] }, {}, [])).toBe('extend');
    expect(payKind({ user_id: U, property_id: P, sends: [{}] }, {}, [st(H, { kind: 'listing_extend', plan: null })])).toBe('extend');
    expect(unpaidKind('extend')).toBe('unpaid_extend');
    expect(payLabel('extend')).toBe('Waiting for payment: Listing extension');
  });

  it('the day\'s drafts: first emails, payment reminders and fix reminders, never to someone we can\'t email', () => {
    const pay = payThreads([{ id: 'r', created_at: 'x', actions: [{ status: 'sent', kind: 'unpaid_listing', user_id: 'u2', property_id: 'p2', sent_at: iso(NOW - 3 * DAY), subject: 'S', plan: 'home' }] }]);
    const state = {
      site: 'https://casa-libre.com.py',
      checkouts: newCheckouts({ payments: [st(3 * H)], listingsById: live, now: NOW }),
      payPlan: { resend: [...pay.values()], escalate: [] },
      fixPlan: { resend: [], escalate: [] },
      listingsById: new Map([...live, ['p2', { status: 'published' }]]),
      usersById: new Map([[U, { email: 'a@x.com' }], ['u2', { email: 'b@x.com' }]]),
      payments: [],
    };
    const all = dailyDrafts(state, { canEmail: (u) => !!u?.email });
    expect(all.map((d) => [d.followup, d.plan, d.status])).toEqual([[0, 'verified', 'draft'], [1, 'home', 'draft']]);
    expect(all.every((d) => d.id && d.section === 'listings')).toBe(true);
    expect(dailyDrafts(state, { canEmail: (u) => u?.email === 'b@x.com' }).length).toBe(1);
  });
});
