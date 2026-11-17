// "Personalize your profile" — admin side (the website sends it hourly:
// lib/automations/profileNudge.js there, from /api/cron/automations).
// The settings are the `automations` row 'profile_personalization' (no table of its own):
//   enabled / enabled_at · milestones = HOURS after sign-up for each email, default
//   [0, 24, 48] (right after sign-up, +24 h, +48 h; 1–5 emails, 0 h to 60 days) ·
//   template_id → the first email · reminder_template_id → every later email.
// Who gets it: verified users whose profile is NOT personalized (lib/profileCompletion.js
// isPersonalized: photo or logo + first + last name + title or company, or all 7 items);
// it stops as soon as it is. Each email once per person.
// Nothing is written until an admin saves the card; the first save creates the row and the
// two default (Spanish) emails. Pure — test/profileNudgeAdmin.test.js.

export const PROFILE_NUDGE_ID = 'profile_personalization';
export const PROFILE_DEFAULT_STEPS = [0, 24, 48];
export const PROFILE_STEPS = { max: 5, minHours: 0, maxHours: 60 * 24 };

// 48 → { value: 2, unit: 'days' }; 30 → { value: 30, unit: 'hours' }; 0 → { value: 0, unit: 'hours' }
export const profileStepFromHours = (h) => (Number(h) > 0 && Number(h) % 24 === 0 ? { value: Number(h) / 24, unit: 'days' } : { value: Number(h), unit: 'hours' });
const normalize = (m) => [...new Set((Array.isArray(m) ? m : []).map(Number)
  .filter((n) => Number.isInteger(n) && n >= PROFILE_STEPS.minHours && n <= PROFILE_STEPS.maxHours))].sort((a, b) => a - b).slice(0, PROFILE_STEPS.max);

// "right after sign-up" · "24 hours" · "2 days"
export const profileStepLabel = (h) => {
  if (Number(h) === 0) return 'right after sign-up';
  const s = profileStepFromHours(h);
  return `${s.value} ${s.unit === 'days' ? (s.value === 1 ? 'day' : 'days') : (s.value === 1 ? 'hour' : 'hours')} after sign-up`;
};

// The row → the card's fields.
export function profileNudgeConfig(row) {
  const steps = Array.isArray(row?.milestones) ? normalize(row.milestones) : [];
  return {
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    steps: steps.length ? steps : [...PROFILE_DEFAULT_STEPS],
    templateId: row?.template_id || '',
    reminderTemplateId: row?.reminder_template_id || '',
  };
}

// input uses the card's names: { steps: [hours…], templateId, reminderTemplateId, enabled }.
export function validateProfileNudgeSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = profileNudgeConfig(currentRow);
  const errors = {};
  let steps = cur.steps;
  if (input.steps !== undefined) {
    const raw = Array.isArray(input.steps) ? input.steps : [];
    if (!raw.length) errors.steps = 'Add at least one email.';
    else if (raw.length > PROFILE_STEPS.max) errors.steps = `At most ${PROFILE_STEPS.max} emails.`;
    raw.forEach((h, i) => {
      const n = Number(h);
      if (!Number.isInteger(n) || n < PROFILE_STEPS.minHours || n > PROFILE_STEPS.maxHours) errors[`step_${i}`] = 'From 0 hours (right after sign-up) to 60 days.';
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

// The two emails, created on first save if missing (Spanish — edit them in Email templates).
// Brand written "Casa-Libre". {{progress_line}} adapts to people who started but didn't finish.
export const PROFILE_TEMPLATES = [
  {
    key: 'profile-personalize', col: 'template_id', name: 'Personalizá tu perfil — primer email',
    subject: 'Mostrales a los compradores quién sos: personalizá tu perfil',
    heading: 'Los compradores quieren saber con quién hablan',
    body: 'Hola {{name}},\n\nEn Casa-Libre cada publicación muestra a su vendedor. Los compradores se sienten más cómodos cuando saben con quién están tratando: una cara o un logo, un nombre, un cargo y una empresa generan confianza, y la confianza trae **más consultas**.\n\n{{progress_line}}\n\n**Cómo personalizar tu perfil (2 minutos):** entrá a Mi cuenta → Ajustes, subí tu foto o el logo de tu empresa, completá nombre, apellido, cargo, empresa y sitio web, tocá **Guardar** y confirmá tu WhatsApp.\n\nTu perfil aparece en todas tus publicaciones, en la web y en la app de Casa-Libre para iPhone y Android.',
    button_label: 'Personalizar mi perfil', button_url: '{{settings_url}}',
  },
  {
    key: 'profile-personalize-reminder', col: 'reminder_template_id', name: 'Personalizá tu perfil — recordatorio',
    subject: 'Tu perfil de Casa-Libre está al {{progress_pct}} %',
    heading: 'Un perfil completo trae más consultas',
    body: 'Hola {{name}},\n\n{{progress_line}}\n\nUn perfil completo (foto o logo, nombre, cargo, empresa, sitio web y WhatsApp confirmado) les muestra a los compradores que sos una persona real y confiable. Por eso le escriben más a quien tiene el perfil completo.\n\nTe lleva solo un par de minutos desde Mi cuenta → Ajustes.',
    button_label: 'Completar mi perfil', button_url: '{{settings_url}}',
  },
];

// Save the card (the API route's PUT). First save: creates the two default emails (unless
// this country already has them, by key), fills the empty template pickers with them, and
// inserts the row. db = lib/db-shaped (select / insert / update).
export async function saveProfileNudge(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${PROFILE_NUDGE_ID}&limit=1`);
  const body = { ...input };
  if (!cur) {
    const existing = await db.select('email_templates', 'select=id,key');
    for (const t of PROFILE_TEMPLATES) {
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
  const v = validateProfileNudgeSettings(body, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${PROFILE_NUDGE_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: PROFILE_NUDGE_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}

// Sent emails per step, from email_log dedupe keys profile:<user id>:<step>.
export function profileNudgeStepCounts(logs = []) {
  const per = {};
  for (const l of logs) {
    const m = /^profile:[^:]+:(\d+)$/.exec(String(l?.dedupe_key || ''));
    if (m) per[m[1]] = (per[m[1]] || 0) + 1;
  }
  return per;
}
