import { describe, it, expect } from 'vitest';
import { botReason } from '../lib/feedbackBot.js';
import { claimFacts, listingDataFlags, messageTiming, isPaymentClaim } from '../lib/manager/checks.js';
import { buildActions, blockedTargets } from '../lib/manager/actions.js';
import { slicePack, RESEARCHERS } from '../lib/manager/team.js';

describe('bots', () => {
  it("flags Google Play's pre-launch robot and random names, not people", () => {
    expect(botReason({ name: 'xalyqe', email: 'crawlerrobo@gmail.com', rating: 1 })).toMatch(/Automated tester/);
    expect(botReason({ name: 'ekkezo', email: '', message: 'naovjf' })).toMatch(/Random generated name/);
    expect(botReason({ name: 'jodvkr' })).toMatch(/Random/);
    expect(botReason({ name: 'Carmen Da Costa', email: 'carmen@gmail.com', message: 'He pagado…' })).toBeNull();
    expect(botReason({ name: 'roberto', message: 'Excelente' })).toBeNull();
    expect(botReason({ name: 'carlos' })).toBeNull();
    expect(botReason({ name: 'xalyqe', user_id: 'u1' })).toBeNull();   // an account is a person
  });
});

describe('claims', () => {
  const fb = { id: 'f1', rating: 1, created_at: '2026-10-09T12:18:00Z', message: 'Soy Carmen. He pagado G. 249.000 para publicar … comprobante del pago por Bancard.' };
  const user = { id: 'u1', created_at: '2026-10-08T14:26:00Z', last_login_at: '2026-10-10T19:48:00Z' };
  it("Carmen's case reads as a likely false flag, with the reasons", () => {
    const f = claimFacts(fb, {
      user,
      drafts: [{ created_at: '2026-10-09T11:48:00Z', updated_at: '2026-10-10T19:48:20Z' }],
      messages: [{ automation_id: 'draft_reminders', channel: 'email', status: 'sent', created_at: '2026-10-10T18:05:07Z' }],
    });
    expect(f.claimsPayment).toBe(true);
    expect(f.likelyFalseFlag).toBe(true);
    expect(f.signals.join(' ')).toMatch(/no completed payment/);
    expect(f.signals.join(' ')).toMatch(/Bancard/);
    expect(f.signals.join(' ')).toMatch(/unfinished-draft reminder on 2026-10-10 and signed in again/);
  });
  it('a real payment is not a false flag', () => {
    const f = claimFacts(fb, { user, payments: [{ status: 'paid', amount_usd: 5.8, created_at: '2026-10-09T12:00:00Z' }], listings: [] });
    expect(f.likelyFalseFlag).toBe(false);
  });
  it('payment words', () => {
    expect(isPaymentClaim('ya pagué y no aparece')).toBe(true);
    expect(isPaymentClaim('muy buena atención')).toBe(false);
  });
});

describe('listing data', () => {
  it('KM7 Monday: a rent at a sale price, same address and neighborhood', () => {
    const flags = listingDataFlags({ listing_type: 'rent', price: 900000000, price_usd: 115000, address: 'km7 monday', neighborhood: 'km7 monday', property_type: 'Otro', description: '2 cuadra supermercado stop barrio ciudad nueva, casa con salón para negocios' });
    expect(flags.join(' | ')).toMatch(/RENT at about US\$115,000/);
    expect(flags.join(' | ')).toMatch(/same text/);
  });
  it('a normal listing has no flags', () => {
    expect(listingDataFlags({ listing_type: 'sale', price: 900000000, price_usd: 115000, address: 'Av. Mcal. López 1234', neighborhood: 'Villa Morra', property_type: 'Casa', description: 'Casa de 3 dormitorios con patio, cochera y quincho, cerca de todo.' })).toEqual([]);
  });
});

describe('message timing', () => {
  it('rates, send hours and time to act', () => {
    const now = Date.parse('2026-10-23T00:00:00Z');
    const rows = messageTiming({
      messages: [
        { automation_id: 'draft_reminders', channel: 'email', status: 'sent', to_email: 'a@x.com', created_at: '2026-10-10T13:00:00Z', resend_id: 'r1', run_id: 'd1' },
        { automation_id: 'draft_reminders', channel: 'email', status: 'sent', to_email: 'b@x.com', created_at: '2026-10-11T23:00:00Z', resend_id: 'r2', run_id: 'd2' },
        { automation_id: 'listing_views_milestone', channel: 'whatsapp', status: 'read', to_email: 'a@x.com', created_at: '2026-10-12T15:00:00Z' },
      ],
      resend: new Map([['r1', 'clicked'], ['r2', 'bounced']]),
      userByEmail: new Map([['a@x.com', { id: 'u1' }]]),
      listings: [{ created_by: 'u1', created_at: '2026-10-10T16:00:00Z' }],
      drafts: new Map([['d1', { created_at: '2026-10-09T13:00:00Z' }]]),
      offsetH: -3, now,
    });
    const dr = rows.find((r) => r.automation === 'draft_reminders');
    expect(dr).toMatchObject({ sent: 2, bounced: 1, clicked: 1, clickRate: 100, actedWithin7Days: 1 });
    expect(dr.actedAfter).toEqual({ '1–6 h': 1 });
    expect(dr.draftAgeWhenRemindedHours.median).toBe(24);
    expect(dr.bySendHourLocal.find((h) => h.hours === '06–12')).toMatchObject({ sent: 1, clicked: 1 });
    expect(rows.find((r) => r.channel === 'whatsapp')).toMatchObject({ read: 1, readRate: 100 });
  });
});

describe('no drafts for false flags or bots', () => {
  it('drops them, keeps the rest', () => {
    const blocked = blockedTargets({
      claim_checks: [{ verdict: 'false_flag', feedback_id: 'f1', user_id: '11111111-1111-1111-1111-111111111111' }, { verdict: 'confirmed', feedback_id: 'f2' }],
      suspicious: [{ verdict: 'bot', feedback_id: 'f3' }],
    });
    const d = (x) => ({ kind: 'negative_feedback', subject: 's', body: 'b', ...x });
    const { actions, dropped } = buildActions([d({ feedback_id: 'f1' }), d({ user_id: '11111111-1111-1111-1111-111111111111' }), d({ feedback_id: 'f2' }), d({ feedback_id: 'f3' })], { site: 'https://casa-libre.com.py', newId: () => 'x', blocked });
    expect(actions.map((a) => a.feedback_id)).toEqual(['f2']);
    expect(dropped.filter((x) => x.reason === 'false flag or bot')).toHaveLength(3);
  });
});

describe('research team', () => {
  it('each researcher gets its slice plus the basics', () => {
    const pack = { country: 'py', kpis: [], period: {}, feedback: { a: 1 }, scrapers: { b: 2 }, claimChecks: {} };
    const fbSlice = slicePack(pack, RESEARCHERS.find((r) => r.id === 'feedback').keys);
    expect(fbSlice.feedback).toEqual({ a: 1 });
    expect(fbSlice.scrapers).toBeUndefined();
    expect(RESEARCHERS.map((r) => r.id)).toEqual(['feedback', 'listings', 'followups', 'growth', 'catalog']);
  });
});
