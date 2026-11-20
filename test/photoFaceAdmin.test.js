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
