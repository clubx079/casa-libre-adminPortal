import { describe, it, expect } from 'vitest';
import { payThreads, payKind, isPaid, planPayFollowups, payReminderDraft, payEscalationAction, unpaidKind, payLabel, MAX_SENDS } from '../lib/manager/payFollowups.js';
import { managerName } from '../lib/userEmails.js';

const U = '11111111-1111-1111-1111-111111111111';
const P = '22222222-2222-2222-2222-222222222222';
const DAY = 86400e3;
const NOW = Date.parse('2026-11-10T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const sent = (at, extra = {}) => ({ status: 'sent', kind: 'unpaid_listing', user_id: U, property_id: P, sent_at: at, subject: '¿Te ayudamos con el sello Verificado?', reason: 'Opened US$5 Verified checkout', button_url: 'https://casa-libre.com.py/cuenta/publicaciones', ...extra });
const thread = (actions) => payThreads([{ id: 'r', created_at: 'x', actions }]).get(`${U}:${P}`);
const started = (kind, plan, at = '2026-10-31T00:00:00Z') => ({ user_id: U, property_id: P, kind, plan, status: 'started', created_at: at });

describe('payment follow-ups', () => {
  it('groups payment emails per person + listing; ignores other kinds and emails without a listing', () => {
    const t = payThreads([{ id: 'r', created_at: 'x', actions: [sent('2026-11-02T13:00:00Z'), { ...sent('2026-11-02'), kind: 'listing_fix' }, { ...sent('2026-11-02'), property_id: null }, { ...sent('2026-11-02'), status: 'draft' }] }]);
    expect([...t.values()].length).toBe(1);
  });

  it('knows what they were paying for: plan on the email, its button, their checkout, or the waiting listing', () => {
    expect(payKind(thread([sent('2026-11-02', { plan: 'home' })]), {}, [])).toBe('home');
    expect(payKind(thread([sent('2026-11-02', { button_url: 'https://x.py/cuenta/publicaciones?pay=abc&plan=verified' })]), {}, [])).toBe('verified');
    expect(payKind(thread([sent('2026-11-02', { button_url: 'https://x.py/cuenta/publicaciones?pay_listing=abc' })]), {}, [])).toBe('listing');
    expect(payKind(thread([sent('2026-11-02')]), { status: 'published' }, [started('highlight', 'home')])).toBe('home');
    expect(payKind(thread([sent('2026-11-02')]), { status: 'payment_pending' }, [])).toBe('listing');
    expect(payKind(thread([sent('2026-11-02')]), { status: 'published' }, [])).toBe('promo');
  });

  it('paid = a payment after our email, the promotion bought, the listing no longer waiting, or the listing gone', () => {
    const t = thread([sent('2026-11-02T13:00:00Z', { plan: 'verified' })]);
    expect(isPaid(t, null, [])).toBe(true);
    expect(isPaid(t, { status: 'published' }, [])).toBe(false);
    expect(isPaid(t, { status: 'published', promoted_at: '2026-10-01T00:00:00Z' }, [])).toBe(false);   // an old promotion
    expect(isPaid(t, { status: 'published', promoted_at: '2026-11-03T00:00:00Z' }, [])).toBe(true);
    expect(isPaid(t, { status: 'published' }, [{ user_id: U, property_id: P, status: 'succeeded', created_at: '2026-11-04T00:00:00Z' }])).toBe(true);
    const l = thread([sent('2026-11-02T13:00:00Z', { plan: 'listing' })]);
    expect(isPaid(l, { status: 'payment_pending' }, [])).toBe(false);
    expect(isPaid(l, { status: 'published' }, [])).toBe(true);   // paid, gift or the next month's free listings
  });

  it('up to 3 reminders, ≥ 40 h apart, then an action for Omar; nothing once paid', () => {
    const listing = new Map([[P, { status: 'published' }]]);
    const one = payThreads([{ id: 'r', created_at: 'x', actions: [sent(iso(NOW - 3 * DAY))] }]);
    expect(planPayFollowups(one, listing, [], NOW).resend.length).toBe(1);
    const recent = payThreads([{ id: 'r', created_at: 'x', actions: [sent(iso(NOW - 20 * 3600e3))] }]);
    expect(planPayFollowups(recent, listing, [], NOW)).toEqual({ resend: [], escalate: [] });
    const four = payThreads([{ id: 'r', created_at: 'x', actions: Array.from({ length: MAX_SENDS }, (_, i) => sent(iso(NOW - (10 - i) * DAY))) }]);
    expect(MAX_SENDS).toBe(4);   // the first email + 3 reminders
    expect(planPayFollowups(four, listing, [], NOW)).toMatchObject({ resend: [], escalate: [{ key: `${U}:${P}` }] });
    expect(planPayFollowups(four, listing, [{ user_id: U, property_id: P, status: 'succeeded', created_at: iso(NOW - DAY) }], NOW)).toEqual({ resend: [], escalate: [] });
  });

  it('the reminder opens that payment directly, in voseo, and the last one says it is the last', () => {
    const t = thread([sent('2026-11-02T13:00:00Z', { plan: 'verified' })]);
    const d = payReminderDraft(t, { listing: { property_type: 'Casa', neighborhood: 'Ybapobo', status: 'published' }, user: { full_name: 'DERLIS DANIEL LOPEZ' }, site: 'https://casa-libre.com.py/' });
    expect(d.subject).toBe('Recordatorio: ¿Te ayudamos con el sello Verificado?');
    expect(d.body).toMatch(/^Hola Derlis:/);
    expect(d.body).toMatch(/Te escribimos el 2 de noviembre porque empezaste a agregar el sello \*\*Verificado\*\* a tu publicación \(Casa en Ybapobo\)/);
    expect(d.body).toMatch(/US\$5 por 30 días/);
    expect(d.button_url).toBe(`https://casa-libre.com.py/cuenta/publicaciones?pay=${P}&plan=verified`);
    expect(d).toMatchObject({ kind: 'unpaid_listing', plan: 'verified', followup: 1, button_label: 'Agregar el sello Verificado' });
    const three = { ...t, sends: [...t.sends, { ...t.sends[0], at: '2026-11-04T13:00:00Z', subject: 'Recordatorio: ¿Te ayudamos con el sello Verificado?' }, { ...t.sends[0], at: '2026-11-06T13:00:00Z' }] };
    const last = payReminderDraft(three, { listing: {}, user: {}, site: 'https://x.py' });
    expect(last.subject).toBe('Último recordatorio: ¿Te ayudamos con el sello Verificado?');
    expect(last.body).toMatch(/Es el último recordatorio/);
    const listingT = thread([sent('2026-11-02T13:00:00Z', { plan: 'listing', subject: 'Tus dos propiedades esperan un paso' })]);
    const dl = payReminderDraft(listingT, { listing: { property_type: 'Terreno', city: 'Capiatá', status: 'payment_pending' }, user: { full_name: 'Daniel Famoso' }, site: 'https://casa-libre.com.py' });
    expect(dl.button_url).toBe(`https://casa-libre.com.py/cuenta/publicaciones?pay_listing=${P}`);
    expect(dl.body).toMatch(/quedó guardada esperando el pago para publicarse/);
  });

  it('the Omar action says who, what for and when; a waiting listing suggests the gift', () => {
    const four = thread(['2026-11-02', '2026-11-04', '2026-11-06', '2026-11-09'].map((d) => sent(`${d}T13:00:00Z`, { plan: 'listing' })));
    const a = payEscalationAction(four, { listing: { property_type: 'Terreno', city: 'Capiatá', contact_phone: '+595992702850' }, user: { full_name: 'Daniel Famoso' } });
    expect(a.title).toBe("Daniel Famoso hasn't paid after 4 emails");
    expect(a.why).toBe('Started paying for a listing waiting for payment — Terreno en Capiatá. Emailed 11-02, 11-04, 11-06, 11-09; no payment since.');
    expect(a.how).toMatch(/\+595992702850.*gift/);
    expect(a.key).toBe('pay-unpaid-22222222');
  });

  it('each payment email has its own name for the admin', () => {
    expect(unpaidKind('verified')).toBe('unpaid_verified');
    expect(unpaidKind('home')).toBe('unpaid_home');
    expect(unpaidKind('listing')).toBe('unpaid_extra');
    expect(unpaidKind('promo')).toBe('unpaid_listing');
    expect(payLabel('home')).toBe('Waiting for home page display payment');
    expect(managerName('manager_unpaid_verified')).toBe('Admin Manager: Waiting for Verified badge payment');
    expect(managerName('manager_unpaid_home')).toBe('Admin Manager: Waiting for home page display payment');
    expect(managerName('manager_unpaid_extra')).toBe('Admin Manager: Waiting for payment: extra listing');
    expect(managerName('manager_unpaid_listing')).toBe('Admin Manager: Waiting for payment');
  });
});
