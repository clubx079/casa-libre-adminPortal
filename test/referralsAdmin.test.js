import { describe, it, expect } from 'vitest';
import { validateReferralSettings, DEFAULT_TEMPLATES, inviteAudience, roundDownProof, referrerRows, personRows, rewardRows, TEMPLATE_KEYS } from '../lib/referralsAdmin.js';
import { validateTemplate } from '../lib/automationAdmin.js';
import { referralConfig, codeFor, isCode, maskName, REFERRALS_ID } from '../lib/referrals/core.js';
import { automationSlots, AUTOMATION_LABELS } from '../lib/whatsappAdmin.js';

const NOW = '2026-11-09T12:00:00.000Z';

describe('validateReferralSettings', () => {
  it('first save: defaults, enabled stamps enabled_at, settings live in free_tiers[0]', () => {
    const v = validateReferralSettings({ enabled: true }, null, NOW);
    expect(v.ok).toBe(true);
    expect(v.value.enabled).toBe(true);
    expect(v.value.enabled_at).toBe(NOW);
    const cfg = referralConfig({ ...v.value, id: REFERRALS_ID });
    expect(cfg.referrer).toEqual({ enabled: true, plan: 'verified', days: 30 });
    expect(cfg.newUser).toEqual({ enabled: true, plan: 'verified', days: 30 });
    expect(cfg.milestone).toMatchObject({ enabled: true, plan: 'home', days: 30, every: 3, repeat: false });
  });
  it('keeps enabled_at when already on, and edits fields', () => {
    const row = { id: REFERRALS_ID, enabled: true, enabled_at: '2026-11-01T00:00:00Z', free_tiers: [{}] };
    const v = validateReferralSettings({ referrer: { days: '15' }, milestone: { every: 5, repeat: true }, remindDays: '7, 2' }, row, NOW);
    expect(v.ok).toBe(true);
    expect(v.value.enabled_at).toBeUndefined();
    expect(v.value.free_tiers[0].referrer.days).toBe(15);
    expect(v.value.free_tiers[0].milestone).toMatchObject({ every: 5, repeat: true });
    expect(v.value.free_tiers[0].remindDays).toEqual([7, 2]);
  });
  it('rejects bad values with plain messages', () => {
    const v = validateReferralSettings({ referrer: { days: 0, plan: 'gold' }, remindDays: 'x', shareText: 'no link here', inviteChannel: 'whatsapp', inviteWaTemplate: '' }, null, NOW);
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors).sort()).toEqual(['inviteWaTemplate', 'referrer.days', 'referrer.plan', 'remindDays', 'shareText']);
  });
  it('reminders must come before the shortest reward ends', () => {
    expect(validateReferralSettings({ newUser: { days: 3 }, remindDays: '3' }, null, NOW).errors.remindDays).toBeTruthy();
    expect(validateReferralSettings({ newUser: { days: 4 }, remindDays: '3' }, null, NOW).ok).toBe(true);
  });
});

describe('default emails', () => {
  it('pass the template validator (only known variables) and are Spanish with the hyphenated brand', () => {
    expect(DEFAULT_TEMPLATES.map((t) => t.key).sort()).toEqual(Object.values(TEMPLATE_KEYS).sort());
    for (const t of DEFAULT_TEMPLATES) {
      const v = validateTemplate(t);
      expect(v.ok, `${t.key}: ${JSON.stringify(v.errors)}`).toBe(true);
      expect(`${t.subject} ${t.body}`).toMatch(/Casa-Libre/);
      expect(`${t.subject} ${t.body}`).not.toMatch(/Casa Libre|de mayor crecimiento|tecnología líder|Por fin llegó|para siempre/i);
    }
  });
  it('the reward emails are WhatsApp-able slots of the Referral program', () => {
    expect(AUTOMATION_LABELS.referrals).toBe('Referral program');
    const slots = automationSlots({ id: 'referrals' }, DEFAULT_TEMPLATES.map((t, i) => ({ id: `t${i}`, key: t.key, name: t.name })));
    expect(slots.map((s) => s.templateKey)).toEqual(['referral-reward-new', 'referral-reward-referrer', 'referral-milestone', 'referral-ending']);
  });
});

describe('inviteAudience: verified users', () => {
  const users = [
    { id: '1', email: 'a@x.com', verified: true, active: true },
    { id: '2', email: 'b@x.com', verified: false, active: true },
    { id: '3', email: 'c@x.com', verified: true, active: true, blocked: true },
    { id: '4', email: 'd@x.com', verified: true, active: true, suspended: true },
    { id: '5', email: 'omar@airosofts.com', verified: true, active: true },
    { id: '6', email: 'f@x.com', verified: true, active: false },
    { id: '7', email: 'g@x.com', verified: true, active: true },
  ];
  it('verified, active, not blocked/suspended, not internal', () => {
    expect(inviteAudience(users, { isInternal: (e) => e.endsWith('@airosofts.com') }).map((u) => u.id)).toEqual(['1', '7']);
  });
  it('optionally only people with a live listing', () => {
    expect(inviteAudience(users, { liveOwners: new Set(['7']), requireListing: true }).map((u) => u.id)).toEqual(['7']);
  });
});

describe('numbers and tables', () => {
  it('roundDownProof rounds down for the proof line', () => {
    expect(roundDownProof(3622)).toBe('3.600');
    expect(roundDownProof(48)).toBe('48');
    expect(roundDownProof(187)).toBe('180');
  });
  it('referrerRows counts per referrer and builds the link; the new member reward is not the referrer’s', () => {
    const rows = referrerRows({
      codes: [{ run_id: 'r1', subject: 'abcdefgh', created_at: '2026-11-01' }],
      clicks: [{ run_id: 'r1' }, { run_id: 'r1' }],
      persons: [{ run_id: 'r1', subject: 'qualified' }, { run_id: 'r1', subject: 'signed_up' }, { run_id: 'r1', subject: 'rejected' }],
      rewards: [{ run_id: 'r1', subject: 'granted', error: '{"type":"referrer"}' }, { run_id: 'n1', subject: 'granted', error: '{"type":"new_user"}' }],
      users: new Map([['r1', { full_name: 'Rita Test', email: 'rita@x.com' }]]),
      site: 'https://casa-libre.com.py',
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: 'r1', clicks: 2, signups: 3, qualified: 1, waiting: 1, rejected: 1, granted: 1, link: 'https://casa-libre.com.py/ref/abcdefgh', email: 'rita@x.com' });
  });
  it('personRows / rewardRows read the stored details', () => {
    const [p] = personRows([{ id: 'p1', run_id: 'r1', to_email: 'nina@x.com', subject: 'rejected', error: JSON.stringify({ referred_id: 'n1', reason: 'same_person', matched: ['device_id', 'ip'], method: 'google' }) }], new Map([['n1', { full_name: 'Nina Gómez', email: 'nina@x.com' }]]));
    expect(p).toMatchObject({ state: 'rejected', reason: 'same_person', method: 'google', referred: { masked: 'Nina G.', email: 'nina@x.com' } });
    const [r] = rewardRows([{ id: 'w1', run_id: 'n1', subject: 'granted', error: JSON.stringify({ type: 'new_user', plan: 'verified', plan_applied: 'home', days: 30, property_id: 'p9', until: NOW }) }], new Map(), new Map([['p9', { id: 'p9', property_type: 'casa', neighborhood: 'Villa Morra' }]]));
    expect(r).toMatchObject({ type: 'new_user', plan: 'home', listing: { id: 'p9', title: 'casa · Villa Morra' }, until: NOW });
  });
  it('the shared core matches the website: codes and masking', () => {
    expect(isCode(codeFor('u-1'))).toBe(true);
    expect(maskName('Ana María Pérez')).toBe('Ana P.');
  });
});
