import { describe, it, expect } from 'vitest';
import { validatePromoSettings, saveReferralPromo, promoCounts, PROMO_ID, PROMO_TEMPLATE, PROMO_DEFAULTS, promoConfig, promoScheduleText } from '../lib/referralPromoAdmin.js';
import { validateTemplate, templateUsage } from '../lib/automationAdmin.js';
import { TEMPLATE_EN, TEMPLATE_FIELDS, englishName, fixedEnglish } from '../lib/templateEnglish.js';
import { emailResults } from '../lib/emailResults.js';
import { emailType } from '../lib/emailStats.js';
import { renderTemplate, sampleVars } from '../lib/emailTemplateRender.js';

const NOW = '2026-11-11T12:00:00.000Z';

function fakeDb(seed = {}) {
  const t = { automations: [], email_templates: [], ...JSON.parse(JSON.stringify(seed)) };
  let n = 0;
  const where = (q) => [...String(q).matchAll(/(\w+)=eq\.([^&]+)/g)].map((m) => [m[1], decodeURIComponent(m[2])]);
  return {
    t,
    select: async (table, q) => (t[table] || []).filter((r) => where(q).every(([k, v]) => String(r[k]) === v)),
    insert: async (table, rows) => { const made = rows.map((r) => ({ id: r.id || `id-${++n}`, ...r })); (t[table] ||= []).push(...made); return made; },
    update: async (table, q, patch) => { for (const r of t[table].filter((x) => where(q).every(([k, v]) => String(x[k]) === v))) Object.assign(r, patch); return []; },
  };
}

describe('validatePromoSettings', () => {
  it('defaults: 24 h, every 7 days, 3 emails, existing users on, 100 per run, off', () => {
    const v = validatePromoSettings({}, null, NOW);
    expect(v.ok).toBe(true);
    expect(v.value.free_tiers).toEqual([PROMO_DEFAULTS]);
    expect(v.value.enabled).toBe(false);
    expect(PROMO_DEFAULTS).toEqual({ firstAfterHours: 24, everyDays: 7, maxSends: 3, includeExisting: true, perRun: 100 });
  });
  it('takes any 1–60 days between emails, rejects outside the ranges', () => {
    for (const d of [1, 3, 4, 7, 60]) expect(validatePromoSettings({ everyDays: d }, null, NOW).value.free_tiers[0].everyDays).toBe(d);
    const bad = validatePromoSettings({ everyDays: 61, firstAfterHours: 0, maxSends: 11, perRun: 0 }, null, NOW);
    expect(bad.ok).toBe(false);
    expect(Object.keys(bad.errors).sort()).toEqual(['everyDays', 'firstAfterHours', 'maxSends', 'perRun']);
    expect(validatePromoSettings({ everyDays: '' }, null, NOW).errors.everyDays).toBeTruthy();
    expect(validatePromoSettings({ everyDays: 2.5 }, null, NOW).ok).toBe(false);
  });
  it('switching on stamps enabled_at once and needs a template', () => {
    expect(validatePromoSettings({ enabled: true }, null, NOW).errors.enabled).toMatch(/template/);
    const on = validatePromoSettings({ enabled: true, templateId: 't1' }, null, NOW);
    expect(on.ok).toBe(true);
    expect(on.value.enabled_at).toBe(NOW);
    const again = validatePromoSettings({ everyDays: 4 }, { id: PROMO_ID, enabled: true, enabled_at: '2026-11-01T00:00:00Z', template_id: 't1' }, NOW);
    expect(again.value.enabled_at).toBeUndefined();
    expect(again.value.enabled).toBe(true);
    expect(again.value.template_id).toBe('t1');
  });
  it('keeps the saved settings for the fields not sent', () => {
    const row = { id: PROMO_ID, enabled: false, template_id: 't1', free_tiers: [{ firstAfterHours: 48, everyDays: 3, maxSends: 5, includeExisting: false, perRun: 20 }] };
    expect(validatePromoSettings({ maxSends: 2 }, row, NOW).value.free_tiers[0]).toEqual({ firstAfterHours: 48, everyDays: 3, maxSends: 2, includeExisting: false, perRun: 20 });
  });
});

describe('saveReferralPromo', () => {
  it('first save creates the default email + the row (off), later saves update it', async () => {
    const db = fakeDb();
    const r = await saveReferralPromo(db, { everyDays: 4 }, NOW);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(r.templateCreated).toBe(true);
    expect(db.t.email_templates).toHaveLength(1);
    expect(db.t.email_templates[0]).toMatchObject({ key: 'referral-promo', subject: PROMO_TEMPLATE.subject, is_active: true });
    const row = db.t.automations[0];
    expect(row).toMatchObject({ id: PROMO_ID, enabled: false, template_id: db.t.email_templates[0].id });
    expect(row.free_tiers[0].everyDays).toBe(4);
    const r2 = await saveReferralPromo(db, { enabled: true }, NOW);
    expect(r2.created).toBe(false);
    expect(db.t.email_templates).toHaveLength(1);
    expect(db.t.automations[0]).toMatchObject({ enabled: true, enabled_at: NOW });
  });
  it('reuses an existing template with the key (never overwrites it)', async () => {
    const db = fakeDb({ email_templates: [{ id: 'mine', key: 'referral-promo', subject: 'Mi asunto' }] });
    await saveReferralPromo(db, {}, NOW);
    expect(db.t.email_templates).toEqual([{ id: 'mine', key: 'referral-promo', subject: 'Mi asunto' }]);
    expect(db.t.automations[0].template_id).toBe('mine');
  });
  it('a refused save writes nothing to the row', async () => {
    const db = fakeDb();
    const r = await saveReferralPromo(db, { everyDays: 0 }, NOW);
    expect(r.ok).toBe(false);
    expect(db.t.automations).toHaveLength(0);
  });
});

describe('promoCounts', () => {
  it('counts sent emails per step and people, opt-outs and bounces apart', () => {
    const c = promoCounts([
      { dedupe_key: 'refpromo:u1:1', status: 'sent' }, { dedupe_key: 'refpromo:u1:2', status: 'sent' }, { dedupe_key: 'refpromo:u1:2:wa', status: 'sent' },
      { dedupe_key: 'refpromo:u2:1', status: 'sent' }, { dedupe_key: 'refpromo:u3:1', status: 'failed' },
      { dedupe_key: 'refpromo-stop:u2:ev', subject: 'unsubscribed', status: 'sent' }, { dedupe_key: 'refpromo-stop:u4:ev', subject: 'bounced', status: 'sent' },
    ]);
    expect(c).toEqual({ sent: 3, people: 2, perStep: { 1: 2, 2: 1 }, optedOut: 1, bounced: 1 });
  });
});

describe('the default email', () => {
  it('is a valid template (only known variables) with a fixed English preview', () => {
    expect(validateTemplate({ ...PROMO_TEMPLATE }).ok).toBe(true);
    const en = fixedEnglish({ ...PROMO_TEMPLATE });
    for (const f of TEMPLATE_FIELDS) expect(en[f]).toBe(TEMPLATE_EN['referral-promo'][f].en);
    expect(englishName({ key: 'referral-promo', name: PROMO_TEMPLATE.name })).toBe('Referrals — promo after sign-up');
    expect(en.subject).toBe('Invite someone to list on Casa-Libre and earn {{reward_plan}} for free');
  });
  it('renders in the admin preview with the opt-out link and the button', () => {
    const m = renderTemplate(PROMO_TEMPLATE, sampleVars, { tld: '.py' });
    expect(m.subject).toBe('Invitá a alguien a publicar en Casa-Libre y ganá la insignia Verificada gratis');
    expect(m.html).toContain('api/referral-promo/stop?token=ejemplo');
    expect(m.html).toContain('Compartir mi link');
    expect(m.text).toContain('Ya hay más de 3.600 propiedades activas en Casa-Libre.');
  });
  it('shows as used by the automation, as its own email type, and its opt-out records are not counted as sent', () => {
    expect(templateUsage('t9', [{ id: PROMO_ID, template_id: 't9' }])).toEqual(['Promote the referral program → email']);
    expect(emailType(PROMO_TEMPLATE.subject.replace('{{reward_plan}}', 'la insignia Verificada'))).toBe('Referral program promo');
    const r = emailResults({ logs: [
      { automation_id: PROMO_ID, channel: 'email', status: 'sent' },
      { automation_id: PROMO_ID, channel: 'event', status: 'sent' },
    ] });
    expect(r[0]).toMatchObject({ automation: PROMO_ID, label: 'Promote the referral program', sent: 1 });
  });
  it('schedule text for the pages', () => {
    expect(promoScheduleText(promoConfig(null))).toBe('1 day after sign-up, then every 7 days · up to 3 emails');
  });
});
