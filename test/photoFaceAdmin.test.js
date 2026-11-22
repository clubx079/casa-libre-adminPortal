import { describe, it, expect } from 'vitest';
import {
  PHOTO_FACE_ID, PHOTO_FACE_DEFAULT_STEPS, PHOTO_FACE_TEMPLATES, photoFaceConfig, validatePhotoFaceSettings,
  photoFaceStepLabel, photoFaceStepCounts, savePhotoFace,
} from '../lib/photoFaceAdmin.js';

describe('Show your face — admin settings', () => {
  it('defaults: 1, 3 and 7 days after the photo is approved, off', () => {
    expect(PHOTO_FACE_DEFAULT_STEPS).toEqual([24, 72, 168]);
    const c = photoFaceConfig(null);
    expect(c.enabled).toBe(false);
    expect(c.steps).toEqual([24, 72, 168]);
    expect(photoFaceStepLabel(24)).toBe('1 day after the photo is approved');
    expect(photoFaceStepLabel(0)).toBe('right after the photo is approved');
  });
  it('steps are editable: how many emails and when (1–5, 0 h – 60 days)', () => {
    expect(validatePhotoFaceSettings({ steps: [48, 24] }).value.milestones).toEqual([24, 48]);
    expect(validatePhotoFaceSettings({ steps: [] }).errors.steps).toMatch(/at least one/);
    expect(validatePhotoFaceSettings({ steps: [1, 2, 3, 4, 5, 6] }).errors.steps).toMatch(/At most 5/);
    expect(validatePhotoFaceSettings({ steps: [24 * 61] }).errors.step_0).toBeTruthy();
    expect(validatePhotoFaceSettings({ steps: [24, 24] }).errors.steps).toMatch(/same time/);
  });
  it('switching on needs a template and stamps enabled_at', () => {
    expect(validatePhotoFaceSettings({ enabled: true }).errors.enabled).toBeTruthy();
    const v = validatePhotoFaceSettings({ enabled: true, templateId: 't1' }, null, '2026-11-20T10:00:00Z');
    expect(v.ok).toBe(true);
    expect(v.value.enabled_at).toBe('2026-11-20T10:00:00Z');
  });
  it('the emails: Spanish, button to Settings, names what they uploaded, no opt-out line', () => {
    for (const t of PHOTO_FACE_TEMPLATES) {
      expect(t.body).toContain('{{photo_line}}');
      expect(t.button_url).toBe('{{settings_url}}');
      expect(t.body).toMatch(/Casa-Libre para iPhone y Android/);
      expect(t.body).not.toMatch(/BAJA|baja|unsubscribe|darte de baja/i);
    }
  });
  it('first save creates the two emails and the row; counts per step', async () => {
    const rows = { automations: [], email_templates: [] };
    const db = {
      select: async (t, q) => (t === 'automations' ? rows.automations.filter((r) => q.includes(`id=eq.${r.id}`)) : rows.email_templates),
      insert: async (t, r) => { const made = r.map((x, i) => ({ id: `${t}-${rows[t].length + i}`, ...x })); rows[t].push(...made); return made; },
      update: async () => [],
    };
    const v = await savePhotoFace(db, { steps: [24, 72] });
    expect(v.ok).toBe(true);
    expect(rows.email_templates.map((t) => t.key)).toEqual(['photo-face', 'photo-face-reminder']);
    expect(rows.automations[0]).toMatchObject({ id: PHOTO_FACE_ID, milestones: [24, 72], enabled: false });
    expect(photoFaceStepCounts([{ dedupe_key: 'photoface:u1:1' }, { dedupe_key: 'photoface:u2:1' }, { dedupe_key: 'photoface:u1:2' }, { dedupe_key: 'profile:u1:1' }])).toEqual({ 1: 2, 2: 1 });
  });
});

import {
  PHOTO_WRONG_ID, PHOTO_WRONG_DEFAULT_STEPS, PHOTO_WRONG_TEMPLATES, photoWrongConfig, validatePhotoWrongSettings,
  photoWrongCounts, photoWrongStepLabel, rejectedWhatLabel,
} from '../lib/photoFaceAdmin.js';

describe('Show your face — wrong-photo part', () => {
  it('defaults: 2 hours, 2 and 7 days after the upload was turned down; off until saved', () => {
    expect(PHOTO_WRONG_DEFAULT_STEPS).toEqual([2, 48, 168]);
    const c = photoWrongConfig(null);
    expect(c).toMatchObject({ setUp: false, enabled: false, steps: [2, 48, 168] });
    expect(photoWrongStepLabel(2)).toBe('2 hours after the upload was turned down');
    expect(photoWrongStepLabel(48)).toBe('2 days after the upload was turned down');
  });
  it('validation: steps 1–5, needs the first email to switch on; maps to the row columns', () => {
    expect(validatePhotoWrongSettings({ steps: [] }).errors.wrong_steps).toMatch(/at least one/);
    expect(validatePhotoWrongSettings({ steps: [24 * 61] }).errors.wrong_step_0).toBeTruthy();
    expect(validatePhotoWrongSettings({ enabled: true }).errors.wrong_enabled).toBeTruthy();
    const v = validatePhotoWrongSettings({ enabled: true, steps: [48, 2], templateId: 'a', reminderTemplateId: 'b', keptTemplateId: 'c' }, null, '2026-11-22T10:00:00Z');
    expect(v.ok).toBe(true);
    expect(v.value).toMatchObject({ milestones: [2, 48], template_id: 'a', reminder_template_id: 'b', gift_template_id: 'c', enabled: true, enabled_at: '2026-11-22T10:00:00Z' });
  });
  it('the three emails: Spanish, Casa-Libre, button to Settings, say what happened, no opt-out line, short', () => {
    expect(PHOTO_WRONG_TEMPLATES.map((t) => t.key)).toEqual(['photo-wrong', 'photo-wrong-reminder', 'photo-wrong-kept']);
    for (const t of [...PHOTO_WRONG_TEMPLATES, ...PHOTO_FACE_TEMPLATES]) {
      expect(t.body).toContain('{{photo_line}}');
      expect(t.button_url).toBe('{{settings_url}}');
      expect(t.body).toMatch(/Casa-Libre para iPhone y Android/);
      expect(t.body).not.toMatch(/Casa Libre/);
      expect(t.body).not.toMatch(/BAJA|unsubscribe|darte de baja|no recibir/i);
      expect(t.body.length).toBeLessThan(420);
    }
  });
  it('saving the card with `wrong` creates the three emails and the row once', async () => {
    const rows = { automations: [], email_templates: [] };
    const db = {
      select: async (t, q) => (t === 'automations' ? rows.automations.filter((r) => q.includes(`id=eq.${r.id}&`)) : rows.email_templates),
      insert: async (t, r) => { const made = r.map((x, i) => ({ id: `${t}-${rows[t].length + i}`, ...x })); rows[t].push(...made); return made; },
      update: async (t, q, patch) => { for (const r of rows[t]) if (q.includes(`id=eq.${r.id}`)) Object.assign(r, patch); return []; },
    };
    const v = await savePhotoFace(db, { steps: [24], wrong: { enabled: true, steps: [2, 48] } }, '2026-11-22T10:00:00Z');
    expect(v.ok).toBe(true);
    expect(rows.email_templates.map((t) => t.key)).toEqual(['photo-face', 'photo-face-reminder', 'photo-wrong', 'photo-wrong-reminder', 'photo-wrong-kept']);
    const w = rows.automations.find((r) => r.id === PHOTO_WRONG_ID);
    expect(w).toMatchObject({ enabled: true, milestones: [2, 48], enabled_at: '2026-11-22T10:00:00Z' });
    expect(w.template_id && w.reminder_template_id && w.gift_template_id).toBeTruthy();
    // second save: switched off, nothing new created
    await savePhotoFace(db, { wrong: { enabled: false } });
    expect(rows.email_templates.length).toBe(5);
    expect(rows.automations.find((r) => r.id === PHOTO_WRONG_ID).enabled).toBe(false);
  });
  it('counts + labels', () => {
    expect(photoWrongCounts([{ dedupe_key: 'photowrong:u1:1' }, { dedupe_key: 'photowrong:u2:1' }, { dedupe_key: 'photowrong:u1:2' }, { dedupe_key: 'photowrongkept:u3:1763800000000' }, { dedupe_key: 'photoface:u1:1' }]))
      .toEqual({ perStep: { 1: 2, 2: 1 }, kept: 1, sent: 4 });
    expect(photoFaceStepCounts([{ dedupe_key: 'photowrong:u1:1' }])).toEqual({});
    expect(rejectedWhatLabel('apartment')).toBe('an apartment');
    expect(rejectedWhatLabel('???')).toBe('something else');
  });
});
