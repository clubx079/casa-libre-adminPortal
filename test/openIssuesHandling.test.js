import { describe, it, expect } from 'vitest';
import { handlingFor, historyItem } from '../lib/openIssuesHandling.js';
import { buildIssues } from '../lib/openIssues.js';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const D = 86400000;
const DAY_HALF = 6 * 3600000;
const iso = (ms) => new Date(ms).toISOString();
const person = { name: 'Daniel', email: 'd@x.com', phone: '+595992702850', userId: 'u1' };
const row = (automation_id, ago, extra = {}) => ({ automation_id, created_at: iso(NOW - ago), to_email: 'd@x.com', to_phone: '+595992702850', status: 'sent', channel: 'email', ...extra });

describe('was it handled? (every issue)', () => {
  it('a payment issue: who did what, the goal, and the next reminder', () => {
    const history = [
      row('listing_held', 20 * D, { subject: 'Tu publicación está guardada' }),
      row('manager', 6 * D, { template_key: 'manager_unpaid_extra', subject: 'Tus dos propiedades esperan un paso', status: 'read' }),
      row('inbox_ai', 5 * D, { channel: 'whatsapp', error: JSON.stringify({ goal: 'pay', english: 'Explained the charge, sent the pay link' }) }),
      row('wa_reply', 4 * D, { template_key: 'si', subject: 'Tapped SÍ' }),
      row('draft_reminders', 3 * D, { subject: 'Te falta poco' }),   // another topic: not part of this issue
    ];
    const payThreads = new Map([['u1:p1', { user_id: 'u1', property_id: 'p1', sends: [{ at: iso(NOW - 6 * D) }, { at: iso(NOW - 3 * D) }] }]]);
    const tr = handlingFor({ type: 'payment', person, since: iso(NOW - 21 * D), data: { propertyIds: ['p1'] } }, { history, payThreads, now: NOW });
    expect(tr.handled).toBe(true);
    expect(tr.items.map((x) => x.by)).toEqual(['AI assistant (WhatsApp)', 'Admin Manager (email)', 'Automation (email)']);
    expect(tr.items[1]).toMatchObject({ what: '“Tus dos propiedades esperan un paso”', status: 'read' });
    expect(tr.their.map((x) => x.what)).toEqual(['Tapped SÍ']);
    expect(tr.goal).toEqual({ text: 'The listing gets paid (or published as a gift)', reached: false });
    expect(tr.reminders).toBe('Yes — 1 of 3 reminders sent (last 2026-11-07); reminder 2 of 3 goes out from 2026-11-10.');
    const one = new Map([['k', { user_id: 'u1', property_id: 'p1', sends: [{ at: iso(NOW - DAY_HALF) }] }]]);
    expect(handlingFor({ type: 'payment', person, since: iso(NOW - D), data: { propertyIds: ['p1'] } }, { payThreads: one, now: NOW }).reminders).toBe('Yes — the first payment email went out 2026-11-10; reminder 1 of 3 goes out from 2026-11-11.');
  });

  it('all reminders used → says so; no thread → explains when they start', () => {
    const sends = ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-07'].map((d) => ({ at: `${d}T12:00:00Z` }));
    const tr = handlingFor({ type: 'payment', person, since: iso(NOW - 10 * D), data: { propertyIds: ['p1'], plan: 'verified' } }, { payThreads: new Map([['k', { user_id: 'u1', property_id: 'p1', sends }]]), now: NOW });
    expect(tr.reminders).toBe('No — the first email and all 3 reminders were sent (11-01, 11-03, 11-05, 11-07).');
    expect(tr.goal.text).toBe('They finish buying it');
    expect(tr.handled).toBe(false);   // (no history rows given here)
    expect(handlingFor({ type: 'payment', person, since: iso(NOW), data: { propertyIds: ['p9'] } }, { now: NOW }).reminders).toMatch(/starts when they open the payment/);
    expect(handlingFor({ type: 'funnel', id: 'funnel:checkout:x', person, since: iso(NOW), data: {} }, { now: NOW }).reminders).toMatch(/no listing/);
  });

  it('a message issue: the assistant and the team in the chat; nothing sent → "not yet"', () => {
    const tr = handlingFor({ type: 'unanswered', person, since: iso(NOW - D) }, {
      history: [row('inbox_ai_person', D / 2, { channel: 'whatsapp', error: JSON.stringify({ note: 'asks for a refund' }) })],
      teamByPhone: new Map([['92702850', [{ at: iso(NOW - D / 4), by: 'omar' }]]]), now: NOW,
    });
    expect(tr.items.map((x) => `${x.by}: ${x.what}`)).toEqual(['Team (omar): wrote in the chat', 'AI assistant (WhatsApp): passed it to a person — asks for a refund']);
    expect(tr.reminders).toBe('No automatic reminder — this one needs a person.');
    const none = handlingFor({ type: 'keyword', person: { ...person, email: null, phone: '+595981111111' }, since: iso(NOW) }, { now: NOW });
    expect(none.handled).toBe(false);
    expect(none.goal.text).toBe('A person from the team talks to them');
  });

  it('their taps and opt-outs show as what THEY did', () => {
    expect(historyItem(row('wa_reply', 0, { template_key: 'baja', subject: 'Opted out: replied BAJA' }))).toMatchObject({ by: 'Them', what: 'Opted out: replied BAJA', them: true });
  });
});

describe('payment cards', () => {
  const users = new Map([['u1', { id: 'u1', full_name: 'Daniel Famoso', email: 'd@x.com', phone: '+595992702850' }]]);
  it('after every payment email → a card: the gift for an unpaid listing, a call for a promotion', () => {
    const sends = ['2026-11-01', '2026-11-03', '2026-11-05', '2026-11-07'].map((d) => ({ at: `${d}T12:00:00Z` }));
    const issues = buildIssues({ now: NOW, usersById: users, payExhausted: [
      { user_id: 'u1', property_id: 'p1', plan: 'listing', sends, listing: { property_type: 'Casa', city: 'Capiatá' } },
      { user_id: 'u1', property_id: 'p2', plan: 'verified', sends, listing: { property_type: 'Terreno', city: 'Luque' } },
    ] });
    const [gift, call] = issues.filter((i) => i.id.startsWith('payment:exhausted'));
    expect(gift).toMatchObject({ priority: 'high', title: 'Daniel Famoso: Casa · Capiatá still not paid after 4 emails' });
    expect(gift.actions).toContain('publish_free');
    expect(gift.evidence).toContain('Admin Manager payment emails: 4 (11-01, 11-03, 11-05, 11-07) — the first + every reminder');
    expect(call.title).toBe('Daniel Famoso: started buying the Verified badge (US$5) — no payment after 4 emails');
    expect(call.actions).not.toContain('publish_free');
    expect(call.draft.es).toMatch(/sello Verificado/);
  });
  it('the waiting-for-payment card lists the Admin Manager\'s payment emails too', () => {
    const pending = [{ id: 'p1', created_by: 'u1', status: 'payment_pending', created_at: iso(NOW - 10 * D), property_type: 'Casa', city: 'Capiatá' }];
    const followups = { managerByEmail: new Map([['d@x.com', [{ kind: 'manager_unpaid_extra', at: '2026-10-23T17:18:00Z' }, { kind: 'manager_listing_fix', at: '2026-10-24T00:00:00Z' }]]]) };
    const [card] = buildIssues({ now: NOW, usersById: users, pending, listingCountByUser: new Map([['u1', 3]]), followups });
    expect(card.evidence).toContain('Admin Manager payment emails: 1 (10-23)');
  });
});
