// "Show your face" — admin side (the website sends it hourly: lib/automations/photoFace.js there,
// from /api/cron/automations). Roland, Nov 18: a seller whose approved profile photo is a logo,
// text or something else (the AI decides, website lib/profilePhotoKind.js) is encouraged — never
// forced — to upload a real photo of themselves: buyers are more comfortable when they know who
// they are dealing with.
// The settings are the `automations` row 'profile_photo_face' (no table of its own):
//   enabled / enabled_at · milestones = HOURS after the photo was approved for each email,
//   default [24, 72, 168] (1, 3 and 7 days; 1–5 emails, 0 h to 60 days) ·
//   template_id → the first email · reminder_template_id → every later email.
// Before every email the website re-reads the photo: once it is a real photo of the person (or is
// removed) nothing more goes out. Each email once per person.
// Nothing is written until an admin saves the card (or the seed script runs); the first save
// creates the row and the two default (Spanish) emails. Pure — test/photoFaceAdmin.test.js.
//
// Wrong-photo part (Roland, Nov 20 — website lib/automations/photoFace.js pickPhotoWrong): the
// website now turns down uploads that are neither a face nor a logo (nothing saved, the old photo
// kept, the attempt recorded on the users row: profile_photo_rejected_at / _what / _count,
// migration 014). Same card, its own settings row 'profile_photo_face_wrong' (runs only while the
// main row is on):
//   enabled / enabled_at · milestones = HOURS after the turned-down upload (for the "?" photos:
//   after switching on), default [2, 48, 168] · template_id → first wrong-photo email ·
//   reminder_template_id → later ones · gift_template_id → the ONE "your new photo wasn't
//   accepted" email for people who still have a valid photo.

export const PHOTO_FACE_ID = 'profile_photo_face';
export const PHOTO_WRONG_ID = 'profile_photo_face_wrong';
export const PHOTO_WRONG_DEFAULT_STEPS = [2, 48, 168];
export const PHOTO_FACE_DEFAULT_STEPS = [24, 72, 168];
export const PHOTO_FACE_STEPS = { max: 5, minHours: 0, maxHours: 60 * 24 };

export const photoFaceStepFromHours = (h) => (Number(h) > 0 && Number(h) % 24 === 0 ? { value: Number(h) / 24, unit: 'days' } : { value: Number(h), unit: 'hours' });
const normalize = (m) => [...new Set((Array.isArray(m) ? m : []).map(Number)
  .filter((n) => Number.isInteger(n) && n >= PHOTO_FACE_STEPS.minHours && n <= PHOTO_FACE_STEPS.maxHours))].sort((a, b) => a - b).slice(0, PHOTO_FACE_STEPS.max);

// "right after the photo is approved" · "1 day after the photo is approved"
export const photoFaceStepLabel = (h) => {
  if (Number(h) === 0) return 'right after the photo is approved';
  const s = photoFaceStepFromHours(h);
  return `${s.value} ${s.unit === 'days' ? (s.value === 1 ? 'day' : 'days') : (s.value === 1 ? 'hour' : 'hours')} after the photo is approved`;
};

export function photoFaceConfig(row) {
  const steps = Array.isArray(row?.milestones) ? normalize(row.milestones) : [];
  return {
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    steps: steps.length ? steps : [...PHOTO_FACE_DEFAULT_STEPS],
    templateId: row?.template_id || '',
    reminderTemplateId: row?.reminder_template_id || '',
  };
}

export function validatePhotoFaceSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = photoFaceConfig(currentRow);
  const errors = {};
  let steps = cur.steps;
  if (input.steps !== undefined) {
    const raw = Array.isArray(input.steps) ? input.steps : [];
    if (!raw.length) errors.steps = 'Add at least one email.';
    else if (raw.length > PHOTO_FACE_STEPS.max) errors.steps = `At most ${PHOTO_FACE_STEPS.max} emails.`;
    raw.forEach((h, i) => {
      const n = Number(h);
      if (!Number.isInteger(n) || n < PHOTO_FACE_STEPS.minHours || n > PHOTO_FACE_STEPS.maxHours) errors[`step_${i}`] = 'From 0 hours (right after the photo is approved) to 60 days.';
    });
    const clean = normalize(raw);
    if (!errors.steps && clean.length !== raw.length && !Object.keys(errors).some((k) => k.startsWith('step_'))) errors.steps = 'Two emails can’t go out at the same time.';
    if (!Object.keys(errors).length) steps = clean;
  }
  const value = {
    milestones: steps,
    wait_days: 0,
    template_id: input.templateId !== undefined ? (input.templateId || null) : (currentRow?.template_id ?? null),
    reminder_template_id: input.reminderTemplateId !== undefined ? (input.reminderTemplateId || null) : (currentRow?.reminder_template_id ?? null),
  };
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  if (enabled && !value.template_id) errors.enabled = 'Pick the first email template before switching it on.';
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// The two emails (Spanish — edit them in Email templates). Brand written "Casa-Libre".
// {{photo_line}} names what they uploaded (a logo / text, or an image that doesn't show their face).
export const PHOTO_FACE_TEMPLATES = [
  {
    key: 'photo-face', col: 'template_id', name: 'Mostrá tu cara — primer email',
    subject: 'Los compradores quieren ver quién sos',
    heading: 'Sumá una foto tuya a tu perfil',
    body: 'Hola {{name}},\n\n{{photo_line}} Por experiencia, los compradores quieren saber con quién están tratando: una foto de tu cara les da más confianza para escribirte.\n\nSubila en un minuto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Subir mi foto', button_url: '{{settings_url}}',
  },
  {
    key: 'photo-face-reminder', col: 'reminder_template_id', name: 'Mostrá tu cara — recordatorio',
    subject: 'Una foto tuya genera más confianza',
    heading: 'Los compradores quieren saber quién vende',
    body: 'Hola {{name}},\n\n{{photo_line}} Los compradores escriben con más confianza cuando ven la cara de la persona que vende.\n\nSubí tu foto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Subir mi foto', button_url: '{{settings_url}}',
  },
];

// The wrong-photo emails (Spanish). {{photo_line}} says what happened ("La imagen que intentaste
// subir parece ser una foto de una casa…", "La imagen de tu perfil no muestra tu cara ni el logo…",
// "La nueva imagen que subiste parece ser una foto de… seguimos mostrando tu foto anterior").
export const PHOTO_WRONG_TEMPLATES = [
  {
    key: 'photo-wrong', col: 'template_id', name: 'Foto no válida — primer email',
    subject: 'Tu foto de perfil no se pudo usar',
    heading: 'Subí tu foto o el logo de tu empresa',
    body: 'Hola {{name}},\n\n{{photo_line}}\n\nSubí tu foto profesional (tu cara) o el logo de tu empresa. Los compradores confían más en un vendedor que pueden ver.\n\nTe lleva un minuto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Subir mi foto', button_url: '{{settings_url}}',
  },
  {
    key: 'photo-wrong-reminder', col: 'reminder_template_id', name: 'Foto no válida — recordatorio',
    subject: 'Tu perfil de Casa-Libre todavía no tiene tu foto',
    heading: 'Los compradores quieren saber con quién hablan',
    body: 'Hola {{name}},\n\n{{photo_line}}\n\nPor experiencia, los compradores escriben más tranquilos cuando ven quién vende. Subí una foto de tu cara o el logo de tu empresa desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Subir mi foto', button_url: '{{settings_url}}',
  },
  {
    key: 'photo-wrong-kept', col: 'gift_template_id', name: 'Foto no válida — se mantuvo la anterior',
    subject: 'Tu nueva foto de perfil no fue aceptada',
    heading: 'Seguimos mostrando tu foto anterior',
    body: 'Hola {{name}},\n\n{{photo_line}}\n\nSi querés cambiarla, subí una foto tuya (tu cara) o el logo de tu empresa: los compradores confían más en un vendedor que pueden ver. Podés hacerlo desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Cambiar mi foto', button_url: '{{settings_url}}',
  },
];

// "2 hours after the upload was turned down"
export const photoWrongStepLabel = (h) => {
  if (Number(h) === 0) return 'right after the upload was turned down';
  const s = photoFaceStepFromHours(h);
  return `${s.value} ${s.unit === 'days' ? (s.value === 1 ? 'day' : 'days') : (s.value === 1 ? 'hour' : 'hours')} after the upload was turned down`;
};

export function photoWrongConfig(row) {
  const steps = Array.isArray(row?.milestones) ? normalize(row.milestones) : [];
  return {
    setUp: !!row,
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    steps: steps.length ? steps : [...PHOTO_WRONG_DEFAULT_STEPS],
    templateId: row?.template_id || '',
    reminderTemplateId: row?.reminder_template_id || '',
    keptTemplateId: row?.gift_template_id || '',
  };
}

// input = { enabled?, steps?, templateId?, reminderTemplateId?, keptTemplateId? } → the row's columns
export function validatePhotoWrongSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = photoWrongConfig(currentRow);
  const errors = {};
  let steps = cur.steps;
  if (input.steps !== undefined) {
    const raw = Array.isArray(input.steps) ? input.steps : [];
    if (!raw.length) errors.wrong_steps = 'Add at least one email.';
    else if (raw.length > PHOTO_FACE_STEPS.max) errors.wrong_steps = `At most ${PHOTO_FACE_STEPS.max} emails.`;
    raw.forEach((h, i) => {
      const n = Number(h);
      if (!Number.isInteger(n) || n < PHOTO_FACE_STEPS.minHours || n > PHOTO_FACE_STEPS.maxHours) errors[`wrong_step_${i}`] = 'From 0 hours to 60 days.';
    });
    const clean = normalize(raw);
    if (!errors.wrong_steps && clean.length !== raw.length && !Object.keys(errors).some((k) => k.startsWith('wrong_step_'))) errors.wrong_steps = 'Two emails can’t go out at the same time.';
    if (!Object.keys(errors).length) steps = clean;
  }
  const pick = (k, col) => (input[k] !== undefined ? (input[k] || null) : (currentRow?.[col] ?? null));
  const value = {
    milestones: steps,
    wait_days: 0,
    template_id: pick('templateId', 'template_id'),
    reminder_template_id: pick('reminderTemplateId', 'reminder_template_id'),
    gift_template_id: pick('keptTemplateId', 'gift_template_id'),
  };
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  if (enabled && !value.template_id) errors.wrong_enabled = 'Pick the first wrong-photo email before switching it on.';
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// Missing default templates (by key) are created; returns { key → id }.
async function ensureTemplates(db, list) {
  const existing = await db.select('email_templates', 'select=id,key');
  const ids = {};
  for (const t of list) {
    let id = existing.find((e) => e.key === t.key)?.id;
    if (!id) {
      const { col, ...tpl } = t;
      const [made] = await db.insert('email_templates', [{ ...tpl, is_active: true }]);
      id = made?.id;
    }
    ids[t.key] = id;
  }
  return ids;
}

// The wrong-photo part (input.wrong of the card's PUT). First save: creates the three default
// emails (unless this country has them) and the row (on/off as the card sends it). It only
// sends while the main "Show your face" row is on too.
export async function savePhotoWrong(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${PHOTO_WRONG_ID}&limit=1`);
  const body = { ...input };
  if (!cur) {
    const ids = await ensureTemplates(db, PHOTO_WRONG_TEMPLATES);
    const field = { template_id: 'templateId', reminder_template_id: 'reminderTemplateId', gift_template_id: 'keptTemplateId' };
    for (const t of PHOTO_WRONG_TEMPLATES) if (!body[field[t.col]]) body[field[t.col]] = ids[t.key];
  }
  const v = validatePhotoWrongSettings(body, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${PHOTO_WRONG_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: PHOTO_WRONG_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}

// Save the card (the API route's PUT). First save: creates the two default emails (unless
// this country already has them, by key), fills the empty template pickers with them, and
// inserts the row. db = lib/db-shaped (select / insert / update).
export async function savePhotoFace(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${PHOTO_FACE_ID}&limit=1`);
  const { wrong, ...body } = input;
  if (!cur) {
    const existing = await db.select('email_templates', 'select=id,key');
    for (const t of PHOTO_FACE_TEMPLATES) {
      let id = existing.find((e) => e.key === t.key)?.id;
      if (!id) {
        const { col, ...tpl } = t;
        const [made] = await db.insert('email_templates', [{ ...tpl, is_active: true }]);
        id = made?.id;
      }
      const field = t.col === 'template_id' ? 'templateId' : 'reminderTemplateId';
      if (body[field] === undefined || body[field] === null || body[field] === '') body[field] = id;
    }
  }
  const v = validatePhotoFaceSettings(body, cur || null, nowIso);
  if (!v.ok) return v;
  if (wrong && typeof wrong === 'object') {
    const w = await savePhotoWrong(db, wrong, nowIso);
    if (!w.ok) return { ...w, value: v.value };
  }
  if (cur) await db.update('automations', `id=eq.${PHOTO_FACE_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: PHOTO_FACE_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}

// Sent emails per step, from email_log dedupe keys photoface:<user id>:<step>.
export function photoFaceStepCounts(logs = []) {
  const per = {};
  for (const l of logs) {
    const m = /^photoface:[^:]+:(\d+)$/.exec(String(l?.dedupe_key || ''));
    if (m) per[m[1]] = (per[m[1]] || 0) + 1;
  }
  return per;
}

// The wrong-photo part: { perStep: { 1: n, … }, kept: n } from photowrong:<uid>:<step> /
// photowrongkept:<uid>:<ms>.
export function photoWrongCounts(logs = []) {
  const perStep = {};
  let kept = 0;
  for (const l of logs) {
    const k = String(l?.dedupe_key || '');
    const m = /^photowrong:[^:]+:(\d+)$/.exec(k);
    if (m) perStep[m[1]] = (perStep[m[1]] || 0) + 1;
    else if (/^photowrongkept:/.test(k)) kept++;
  }
  return { perStep, kept, sent: Object.values(perStep).reduce((a, b) => a + b, 0) + kept };
}

// The Users page badge: the last turned-down upload (what it looked like), for the admin.
export const WRONG_WHAT_EN = {
  house: 'a house', apartment: 'an apartment', building: 'a building', room: 'a room', land: 'land', property: 'a property',
  object: 'an object', animal: 'an animal', food: 'food', vehicle: 'a vehicle', landscape: 'a landscape', group: 'a group of people',
  drawing: 'a drawing / avatar', no_face: 'a person, face not visible', screenshot: 'a screenshot', document: 'a document', other: 'something else',
};
export const rejectedWhatLabel = (what) => WRONG_WHAT_EN[what] || WRONG_WHAT_EN.other;
