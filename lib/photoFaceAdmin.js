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

export const PHOTO_FACE_ID = 'profile_photo_face';
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
    subject: 'Un consejo para recibir más consultas en Casa-Libre',
    heading: 'Los compradores quieren saber con quién hablan',
    body: 'Hola {{name}},\n\n{{photo_line}}\n\nUsar el logo de tu empresa está bien, pero los compradores se sienten más cómodos cuando saben con quién están tratando. Ver la cara de la persona genera **más confianza**, y la confianza trae **más consultas** por WhatsApp.\n\n**Cómo cambiarla (1 minuto):** entrá a Mi cuenta → Ajustes y subí una foto tuya: de frente, con buena luz y sin otras personas. Tu empresa sigue apareciendo junto a tu nombre.\n\nTu foto aparece en todas tus publicaciones, en la web y en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Subir mi foto', button_url: '{{settings_url}}',
  },
  {
    key: 'photo-face-reminder', col: 'reminder_template_id', name: 'Mostrá tu cara — recordatorio',
    subject: 'Tu foto de perfil puede traerte más consultas',
    heading: 'Mostrales a los compradores quién sos',
    body: 'Hola {{name}},\n\n{{photo_line}}\n\nLos compradores escriben con más confianza a un vendedor que pueden ver. Una foto tuya, de frente y con buena luz, hace que tus publicaciones se vean más profesionales y confiables.\n\nTe lleva un minuto desde Mi cuenta → Ajustes, en la web o en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Subir mi foto', button_url: '{{settings_url}}',
  },
];

// Save the card (the API route's PUT). First save: creates the two default emails (unless
// this country already has them, by key), fills the empty template pickers with them, and
// inserts the row. db = lib/db-shaped (select / insert / update).
export async function savePhotoFace(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${PHOTO_FACE_ID}&limit=1`);
  const body = { ...input };
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
