// "Listing getting saved" — admin side (the website sends it hourly:
// lib/automations/savesMilestone.js there, from /api/cron/automations).
// When a seller's listing reaches one of these save numbers (accounts + visitors without
// an account), the seller gets one message for that number. Settings = the `automations`
// row 'listing_saves_milestone': enabled / enabled_at · milestones (e.g. [5, 10, 25]) ·
// template_id. Channel (Email / WhatsApp / Both) is set in the same card's channel picker.
// Nothing is written until an admin saves the card; the first save creates the row and the
// default (Spanish) email. Pure except saveSavesAutomation (db passed in) — test/savesAdmin.test.js.
import { parseMilestones } from './automationAdmin.js';

export const SAVES_AUTOMATION_ID = 'listing_saves_milestone';
export const SAVES_TEMPLATE_KEY = 'listing-saves';
export const SAVES_DEFAULT_MILESTONES = [5, 10, 25];

export const SAVES_TEMPLATE = {
  key: SAVES_TEMPLATE_KEY,
  name: 'Propiedad guardada — personas interesadas',
  subject: '{{name}}, {{saves}} personas guardaron tu propiedad',
  heading: 'Tu propiedad está gustando',
  body: [
    'Hola {{name}},',
    '¡Buenas noticias! **{{saves}} personas** guardaron **{{property_title}}** en Casa Libre para verla de nuevo.',
    'Es una buena señal: hay interesados. Revisá que la publicación esté completa (fotos, precio y descripción) y tené tu WhatsApp a mano: es muy probable que te escriban.',
    'El equipo de Casa Libre',
  ].join('\n\n'),
  button_label: 'Ver mi propiedad',
  button_url: '{{property_url}}',
};

// The row → the card's fields (defaults before the first save).
export function savesConfig(row) {
  return {
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    milestones: Array.isArray(row?.milestones) && row.milestones.length ? row.milestones.map(Number) : SAVES_DEFAULT_MILESTONES,
    templateId: row?.template_id || null,
  };
}

export function validateSavesSettings(input = {}, current = null, nowIso = new Date().toISOString()) {
  const errors = {};
  const value = {};
  if (input.milestones !== undefined) {
    const m = parseMilestones(input.milestones);
    if (!m.length) errors.milestones = 'Add at least one number of saves, e.g. 10.';
    else if (m.some((n) => !Number.isInteger(n) || n < 1 || n > 100000)) errors.milestones = 'Use whole numbers between 1 and 100,000, separated by commas.';
    else if (m.length > 10) errors.milestones = 'Use at most 10 numbers.';
    else value.milestones = m;
  }
  if (input.template_id !== undefined) value.template_id = input.template_id || null;
  if (input.enabled !== undefined) {
    value.enabled = !!input.enabled;
    if (value.enabled && !current?.enabled) value.enabled_at = nowIso;
  }
  const next = { ...(current || {}), ...value };
  if (next.enabled && !errors.milestones && (!next.template_id || !(next.milestones || []).length)) {
    errors.enabled = 'Set the save numbers and pick an email before switching it on.';
  }
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// Save the card. First time: create the default email and the row (milestones default
// [5, 10, 25], the default email picked).
export async function saveSavesAutomation(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${SAVES_AUTOMATION_ID}&limit=1`);
  let defaults = {};
  if (!cur) {
    let [tpl] = await db.select('email_templates', `select=id&key=eq.${SAVES_TEMPLATE_KEY}&limit=1`);
    if (!tpl) [tpl] = await db.insert('email_templates', [{ ...SAVES_TEMPLATE, is_active: true }]);
    defaults = { milestones: SAVES_DEFAULT_MILESTONES, template_id: tpl?.id || null, enabled: false, wait_days: 0 };
  }
  const v = validateSavesSettings(input, cur ? cur : defaults, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${SAVES_AUTOMATION_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: SAVES_AUTOMATION_ID, ...defaults, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}
