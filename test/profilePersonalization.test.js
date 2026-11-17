import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  profileNudgeConfig, validateProfileNudgeSettings, saveProfileNudge, profileNudgeStepCounts, profileStepFromHours, profileStepLabel,
  PROFILE_TEMPLATES, PROFILE_NUDGE_ID, PROFILE_DEFAULT_STEPS,
} from '../lib/profileNudgeAdmin.js';
import { profileProConfig, validateProfileProSettings, profileProStats, toCents, PROFILE_PRO_DEFAULTS } from '../lib/profileProAdmin.js';
import { userCompletion, isPersonalized } from '../lib/profileCompletion.js';
import { TEMPLATE_EN, TEMPLATE_FIELDS } from '../lib/templateEnglish.js';
import { templateUsage } from '../lib/automationAdmin.js';

const NOW = '2026-11-17T12:00:00.000Z';

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

describe('Personalize your profile — settings', () => {
  it('defaults: off, 3 emails at 0 h / 24 h / 48 h', () => {
    expect(PROFILE_DEFAULT_STEPS).toEqual([0, 24, 48]);
    expect(profileNudgeConfig(null)).toEqual({ enabled: false, enabledAt: null, steps: [0, 24, 48], templateId: '', reminderTemplateId: '' });
    expect(profileNudgeConfig({ milestones: [48, 0] }).steps).toEqual([0, 48]);
  });
  it('step labels and editor rows (0 h stays hours)', () => {
    expect(profileStepFromHours(0)).toEqual({ value: 0, unit: 'hours' });
    expect(profileStepFromHours(48)).toEqual({ value: 2, unit: 'days' });
    expect(profileStepLabel(0)).toBe('right after sign-up');
    expect(profileStepLabel(24)).toBe('1 day after sign-up');
    expect(profileStepLabel(30)).toBe('30 hours after sign-up');
  });
  it('validates steps: 0 h–60 days, 1–5, no duplicates; a template before switching on', () => {
    expect(validateProfileNudgeSettings({ steps: [0, 24, 48], templateId: 't1' }, null, NOW).value).toMatchObject({ milestones: [0, 24, 48], template_id: 't1', enabled: false });
    expect(validateProfileNudgeSettings({ steps: [] }, null, NOW).errors.steps).toBeTruthy();
    expect(validateProfileNudgeSettings({ steps: [0, 1, 2, 3, 4, 5] }, null, NOW).errors.steps).toBeTruthy();
    expect(validateProfileNudgeSettings({ steps: [-1] }, null, NOW).errors.step_0).toBeTruthy();
    expect(validateProfileNudgeSettings({ steps: [24 * 61] }, null, NOW).errors.step_0).toBeTruthy();
    expect(validateProfileNudgeSettings({ steps: [24, 24] }, null, NOW).errors.steps).toBeTruthy();
    const on = validateProfileNudgeSettings({ enabled: true }, null, NOW);
    expect(on.ok).toBe(false);
    expect(on.errors.enabled).toBeTruthy();
    const ok = validateProfileNudgeSettings({ enabled: true, templateId: 't1' }, null, NOW);
    expect(ok.value.enabled_at).toBe(NOW);
  });
  it('first save creates the row + the two Spanish emails; a second save keeps them', async () => {
    const db = fakeDb();
    const r = await saveProfileNudge(db, {}, NOW);
    expect(r.ok).toBe(true);
    expect(db.t.email_templates.map((x) => x.key)).toEqual(['profile-personalize', 'profile-personalize-reminder']);
    const [row] = db.t.automations;
    expect(row).toMatchObject({ id: PROFILE_NUDGE_ID, enabled: false, milestones: [0, 24, 48], template_id: db.t.email_templates[0].id, reminder_template_id: db.t.email_templates[1].id });
    await saveProfileNudge(db, { steps: [0, 72] }, NOW);
    expect(db.t.email_templates).toHaveLength(2);
    expect(db.t.automations[0].milestones).toEqual([0, 72]);
  });
  it('templates: Casa-Libre brand, Settings button, English copies kept in sync', () => {
    for (const t of PROFILE_TEMPLATES) {
      expect(t.button_url).toBe('{{settings_url}}');
      expect(`${t.subject} ${t.body}`).not.toMatch(/Casa Libre/);
      expect(TEMPLATE_EN[t.key].name.es).toBe(t.name);
      for (const f of TEMPLATE_FIELDS) expect(TEMPLATE_EN[t.key][f].es).toBe(t[f]);
    }
    expect(PROFILE_TEMPLATES[0].body).toMatch(/\{\{progress_line\}\}/);
    expect(templateUsage('a', [{ id: PROFILE_NUDGE_ID, template_id: 'a', reminder_template_id: 'b' }])).toEqual(['Personalize your profile → first email']);
  });
  it('counts sent emails per step', () => {
    expect(profileNudgeStepCounts([{ dedupe_key: 'profile:u1:1' }, { dedupe_key: 'profile:u2:1' }, { dedupe_key: 'profile:u1:2' }, { dedupe_key: 'profile:u1:2:wa' }, { dedupe_key: 'x' }])).toEqual({ 1: 2, 2: 1 });
  });
});

describe('Profile personalization pricing — settings', () => {
  it('defaults: OFF (free for everyone)', () => {
    expect(PROFILE_PRO_DEFAULTS.enabled).toBe(false);
    expect(profileProConfig(null)).toMatchObject({ enabled: false, priceCents: 1000, renewCents: 1000, days: 30, firstFree: 100 });
  });
  it('prices in US$ → cents', () => {
    expect(toCents('10')).toBe(1000);
    expect(toCents('9,99')).toBe(999);
    expect(toCents('US$ 12.5')).toBe(1250);
    expect(toCents('abc')).toBeNaN();
    expect(toCents('-1')).toBeNaN();
  });
  it('validates and stores like paid listings: free_days + milestones [price, renewal, first N]', () => {
    const v = validateProfileProSettings({ price: '15', renewPrice: '7.5', days: 60, firstFree: 100 }, null, NOW);
    expect(v.ok).toBe(true);
    expect(v.value).toEqual({ enabled: false, free_days: 60, milestones: [1500, 750, 100] });
    expect(validateProfileProSettings({ firstFree: '' }, null, NOW).value.milestones[2]).toBe(0);
    expect(validateProfileProSettings({ price: 'x', days: 0, firstFree: -1 }, null, NOW).errors).toMatchObject({ price: expect.any(String), days: expect.any(String), firstFree: expect.any(String) });
    const on = validateProfileProSettings({ enabled: true }, { enabled: false, free_days: 30, milestones: [1000, 1000, 0] }, NOW);
    expect(on.value).toMatchObject({ enabled: true, enabled_at: NOW, milestones: [1000, 1000, 0] });
    expect(validateProfileProSettings({ enabled: false }, { enabled: true, enabled_at: 'x' }, NOW).value.enabled_at).toBeUndefined();
  });
  it('the defaults match the website (lib/profilePro.js) when it sits next to this repo', () => {
    const site = path.resolve(__dirname, '../../wt-profile-pro/lib/profilePro.js');
    if (!fs.existsSync(site)) return;
    const src = fs.readFileSync(site, 'utf8');
    for (const [k, v] of Object.entries(PROFILE_PRO_DEFAULTS)) expect(src).toMatch(new RegExp(`${k}: ${v}\\b`));
  });
  it('stats: active / expired people, first-N used, revenue', () => {
    const now = new Date(NOW);
    const later = '2026-12-01T00:00:00Z', earlier = '2026-11-01T00:00:00Z';
    const s = profileProStats([
      { user_id: 'a', kind: 'profile_free', amount_usd: 0, status: 'succeeded', highlight_until: later },
      { user_id: 'b', kind: 'profile', amount_usd: 10, status: 'succeeded', highlight_until: earlier },
      { user_id: 'c', kind: 'profile', amount_usd: 10, status: 'succeeded', highlight_until: earlier },
      { user_id: 'c', kind: 'profile_renew', amount_usd: 8, status: 'succeeded', highlight_until: later },
      { user_id: 'd', kind: 'profile', amount_usd: 10, status: 'failed', highlight_until: later },
    ], now);
    expect(s).toEqual({ people: 3, active: 2, expired: 1, firstFreeUsed: 1, paid: 3, revenue: 28 });
  });
});

describe('Profile completion (copy of the website lib/profileCompletion.js)', () => {
  it('7 items and the "personalized" rule', () => {
    const base = { first_name: 'Ana', last_name: 'López', job_title: 'Agente', profile_photo_url: 'https://x/p.jpg' };
    expect(userCompletion(base).count).toBe(4);
    expect(userCompletion(base).tone).toBe('yellow');
    expect(isPersonalized(userCompletion(base))).toBe(true);
    expect(isPersonalized(userCompletion({ ...base, profile_photo_url: null }))).toBe(false);
    expect(userCompletion({ full_name: 'Ana López' }).count).toBe(2);
    const all = { ...base, company_name: 'X', company_website: 'https://x.com', phone_verified_at: NOW };
    expect(userCompletion(all)).toMatchObject({ count: 7, pct: 100, tone: 'green' });
  });
  it('is identical to the website copy when it sits next to this repo', () => {
    const site = path.resolve(__dirname, '../../wt-profile-pro/lib/profileCompletion.js');
    if (!fs.existsSync(site)) return;
    const strip = (s) => s.replace(/\r/g, '').replace(/^\/\/ COPY of the website[^\n]*\n\/\/[^\n]*\n/, '');
    expect(strip(fs.readFileSync(path.resolve(__dirname, '../lib/profileCompletion.js'), 'utf8'))).toBe(fs.readFileSync(site, 'utf8').replace(/\r/g, ''));
  });
});
