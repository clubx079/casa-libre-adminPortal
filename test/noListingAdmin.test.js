import { describe, it, expect } from 'vitest';
import {
  noListingConfig, validateNoListingSettings, saveNoListing, noListingStepCounts, NO_LISTING_TEMPLATES, NO_LISTING_AUTOMATION_ID,
} from '../lib/noListingAdmin.js';
import { validateTemplate, templateUsage } from '../lib/automationAdmin.js';
import { TEMPLATE_EN, TEMPLATE_FIELDS, englishName } from '../lib/templateEnglish.js';

const NOW = '2026-10-15T12:00:00.000Z';

// Minimal lib/db-shaped store (eq filters only) for the save flow.
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

describe('noListingConfig', () => {
  it('defaults to 2 days, off, no second email', () => {
    expect(noListingConfig(null)).toEqual({ enabled: false, enabledAt: null, days: 2, secondAfter: '', templateId: '', reminderTemplateId: '' });
  });
  it('reads the steps back as days + extra days', () => {
    const c = noListingConfig({ enabled: true, enabled_at: NOW, milestones: [3, 10], template_id: 'a', reminder_template_id: 'b' });
    expect(c).toMatchObject({ enabled: true, days: 3, secondAfter: 7, templateId: 'a', reminderTemplateId: 'b' });
  });
});

describe('validateNoListingSettings', () => {
  it('stores the days after sign-up as milestones + wait_days', () => {
    const v = validateNoListingSettings({ days: 4, templateId: 't1' }, null, NOW);
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ wait_days: 4, milestones: [4], template_id: 't1', enabled: false });
    expect(validateNoListingSettings({ days: 2, secondAfter: 5, templateId: 't1', reminderTemplateId: 't2' }, null, NOW).value.milestones).toEqual([2, 7]);
    expect(validateNoListingSettings({ days: 2, secondAfter: '' }, null, NOW).value.milestones).toEqual([2]);
    expect(validateNoListingSettings({ days: 2, secondAfter: 0 }, null, NOW).value.milestones).toEqual([2]);
  });
  it('rejects bad waits', () => {
    expect(validateNoListingSettings({ days: 0 }).errors.days).toBeTruthy();
    expect(validateNoListingSettings({ days: 61 }).errors.days).toBeTruthy();
    expect(validateNoListingSettings({ days: 'x' }).errors.days).toBeTruthy();
    expect(validateNoListingSettings({ days: 2, secondAfter: 1.5 }).errors.secondAfter).toBeTruthy();
    expect(validateNoListingSettings({ days: 30, secondAfter: 31 }).errors.secondAfter).toBeTruthy();
  });
  it('switching on needs a template and stamps enabled_at once', () => {
    expect(validateNoListingSettings({ enabled: true }, null, NOW).errors.enabled).toBeTruthy();
    const v = validateNoListingSettings({ enabled: true, templateId: 't1' }, null, NOW);
    expect(v.value.enabled_at).toBe(NOW);
    const again = validateNoListingSettings({ days: 3 }, { enabled: true, enabled_at: 'earlier', milestones: [2], template_id: 't1' }, NOW);
    expect(again.value.enabled_at).toBeUndefined();
    expect(again.value.enabled).toBe(true);
    expect(validateNoListingSettings({ enabled: true, templateId: 't1', secondAfter: 3, reminderTemplateId: '' }, null, NOW).errors.reminderTemplateId).toBeTruthy();
  });
});

describe('saveNoListing', () => {
  it('first save creates the row + the two default emails and picks them', async () => {
    const db = fakeDb();
    const r = await saveNoListing(db, { days: 3 }, NOW);
    expect(r.ok).toBe(true);
    expect(r.created).toBe(true);
    expect(db.t.email_templates.map((x) => x.key)).toEqual(['no-listing-welcome', 'no-listing-reminder']);
    const [row] = db.t.automations;
    expect(row).toMatchObject({ id: NO_LISTING_AUTOMATION_ID, enabled: false, wait_days: 3, milestones: [3] });
    expect(row.template_id).toBe(db.t.email_templates[0].id);
    expect(row.reminder_template_id).toBe(db.t.email_templates[1].id);
    // Second save updates in place, no new templates.
    const r2 = await saveNoListing(db, { enabled: true, secondAfter: 4 }, NOW);
    expect(r2.ok).toBe(true);
    expect(db.t.email_templates).toHaveLength(2);
    expect(db.t.automations).toHaveLength(1);
    expect(db.t.automations[0]).toMatchObject({ enabled: true, enabled_at: NOW, milestones: [3, 7] });
  });
  it('reuses templates the country already has (by key)', async () => {
    const db = fakeDb({ email_templates: [{ id: 'mine', key: 'no-listing-welcome' }] });
    await saveNoListing(db, {}, NOW);
    expect(db.t.email_templates).toHaveLength(2);
    expect(db.t.automations[0].template_id).toBe('mine');
  });
  it('an invalid first save writes nothing to the row', async () => {
    const db = fakeDb();
    const r = await saveNoListing(db, { days: 0 }, NOW);
    expect(r.ok).toBe(false);
    expect(db.t.automations).toHaveLength(0);
  });
});

describe('default emails', () => {
  it('are valid templates linking to the sell wizard', () => {
    for (const d of NO_LISTING_TEMPLATES) {
      const { col, ...tpl } = d;
      expect(validateTemplate(tpl).ok).toBe(true);
      expect(d.button_url).toBe('{{publish_url}}');
    }
    expect(NO_LISTING_TEMPLATES[0].subject).toMatch(/Bienvenido a Casa Libre/);
  });
  it('have English for the admin, matching the Spanish defaults', () => {
    for (const d of NO_LISTING_TEMPLATES) {
      expect(TEMPLATE_EN[d.key].name.es).toBe(d.name);
      for (const f of TEMPLATE_FIELDS) expect(TEMPLATE_EN[d.key][f].es).toBe(d[f]);
      expect(englishName({ key: d.key, name: d.name })).toBe(TEMPLATE_EN[d.key].name.en);
    }
    expect(TEMPLATE_EN['no-listing-welcome'].subject.en).toBe('Welcome to Casa Libre — post your first listing for free now');
  });
  it('show as in use by the automation', () => {
    expect(templateUsage('a', [{ id: NO_LISTING_AUTOMATION_ID, template_id: 'a', reminder_template_id: 'b', milestones: [2] }])).toEqual(['Signed up, no listing → welcome email']);
    expect(templateUsage('b', [{ id: NO_LISTING_AUTOMATION_ID, template_id: 'a', reminder_template_id: 'b', milestones: [2, 7] }])).toEqual(['Signed up, no listing → second email']);
  });
});

describe('noListingStepCounts', () => {
  it('counts sent emails per step', () => {
    expect(noListingStepCounts([{ dedupe_key: 'nolisting:u1:1' }, { dedupe_key: 'nolisting:u2:1' }, { dedupe_key: 'nolisting:u1:2' }, { dedupe_key: 'draft:x:1' }])).toEqual({ 1: 2, 2: 1 });
  });
});
