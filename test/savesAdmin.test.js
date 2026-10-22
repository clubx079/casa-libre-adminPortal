import { describe, it, expect } from 'vitest';
import { validateSavesSettings, savesConfig, saveSavesAutomation, SAVES_AUTOMATION_ID, SAVES_DEFAULT_MILESTONES } from '../lib/savesAdmin.js';

describe('"Listing getting saved" settings', () => {
  it('defaults before the first save', () => {
    expect(savesConfig(null)).toEqual({ enabled: false, enabledAt: null, milestones: SAVES_DEFAULT_MILESTONES, templateId: null });
  });
  it('numbers: whole, 1–100000, at most 10; switching on needs numbers + an email', () => {
    expect(validateSavesSettings({ milestones: '10, 5, 5, 20' }).value.milestones).toEqual([5, 10, 20]);
    expect(validateSavesSettings({ milestones: '' }).errors.milestones).toBeTruthy();
    expect(validateSavesSettings({ milestones: 'ten' }).errors.milestones).toBeTruthy();
    expect(validateSavesSettings({ enabled: true }, { milestones: [5], template_id: null }).errors.enabled).toBeTruthy();
    const on = validateSavesSettings({ enabled: true }, { milestones: [5], template_id: 't1', enabled: false }, '2026-10-23T00:00:00Z');
    expect(on.ok).toBe(true);
    expect(on.value.enabled_at).toBe('2026-10-23T00:00:00Z');
  });
  it('the first save creates the default email and the row; later saves update it', async () => {
    const rows = { automations: [], email_templates: [] };
    const db = {
      select: async (t, q) => (t === 'automations' ? rows.automations.filter((r) => q.includes(r.id)) : rows.email_templates.filter((r) => q.includes(r.key))),
      insert: async (t, list) => { const r = { id: t === 'email_templates' ? 'tpl1' : list[0].id, ...list[0] }; rows[t].push(r); return [r]; },
      update: async (t, q, patch) => { Object.assign(rows.automations[0], patch); },
    };
    const r1 = await saveSavesAutomation(db, { milestones: '10, 20', enabled: true }, '2026-10-23T00:00:00Z');
    expect(r1.ok).toBe(true);
    expect(r1.created).toBe(true);
    expect(rows.email_templates[0].key).toBe('listing-saves');
    expect(rows.automations[0]).toMatchObject({ id: SAVES_AUTOMATION_ID, milestones: [10, 20], template_id: 'tpl1', enabled: true, enabled_at: '2026-10-23T00:00:00Z' });
    const r2 = await saveSavesAutomation(db, { enabled: false });
    expect(r2.created).toBe(false);
    expect(rows.automations[0].enabled).toBe(false);
    expect(rows.email_templates).toHaveLength(1);
  });
});
