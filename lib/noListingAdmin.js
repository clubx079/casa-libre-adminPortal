// "Signed up but never listed" — admin side (the buyer portal sends it hourly:
// lib/automations/noListingNudge.js there, from /api/cron/automations).
// The settings are the `automations` row 'no_listing_nudge' (no table of its own):
//   enabled / enabled_at · milestones = DAYS after sign-up for each email ([2] or [2, 7]) ·
//   wait_days mirrors the first · template_id → welcome email ·
//   reminder_template_id → optional second email.
// Nothing is written until an admin saves the card; the first save creates the row and
// the two default (Spanish) emails. Pure — test/noListingAdmin.test.js.

export const NO_LISTING_AUTOMATION_ID = 'no_listing_nudge';
export const NO_LISTING_DEFAULT_DAYS = 2;
export const NO_LISTING_MAX_DAYS = 60;

const int = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

// The row → the card's fields. secondAfter = extra days after the first email ('' = no second email).
export function noListingConfig(row) {
  const m = (Array.isArray(row?.milestones) ? row.milestones : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const days = m[0] || (Number(row?.wait_days) > 0 ? Number(row.wait_days) : NO_LISTING_DEFAULT_DAYS);
  return {
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    days,
    secondAfter: m[1] ? m[1] - days : '',
    templateId: row?.template_id || '',
    reminderTemplateId: row?.reminder_template_id || '',
  };
}

// input uses the card's names: { days, secondAfter, templateId, reminderTemplateId, enabled }.
export function validateNoListingSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = noListingConfig(currentRow);
  const errors = {};
  const days = input.days !== undefined ? int(input.days) : cur.days;
  if (!Number.isInteger(days) || days < 1 || days > NO_LISTING_MAX_DAYS) errors.days = `Between 1 and ${NO_LISTING_MAX_DAYS} days.`;
  const rawSecond = input.secondAfter !== undefined ? input.secondAfter : cur.secondAfter;
  const second = rawSecond === '' || rawSecond == null || Number(rawSecond) === 0 ? null : int(rawSecond);
  if (second !== null && (!Number.isInteger(second) || second < 1)) errors.secondAfter = 'A whole number of days, 1 or more — or leave it empty for no second email.';
  else if (second !== null && !errors.days && days + second > NO_LISTING_MAX_DAYS) errors.secondAfter = `The second email must go out within ${NO_LISTING_MAX_DAYS} days of sign-up.`;

  const value = {
    wait_days: errors.days ? (currentRow?.wait_days ?? NO_LISTING_DEFAULT_DAYS) : days,
    milestones: second && !errors.days && !errors.secondAfter ? [days, days + second] : [errors.days ? cur.days : days],
    template_id: input.templateId !== undefined ? (input.templateId || null) : (currentRow?.template_id ?? null),
    reminder_template_id: input.reminderTemplateId !== undefined ? (input.reminderTemplateId || null) : (currentRow?.reminder_template_id ?? null),
  };
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  if (enabled && !value.template_id) errors.enabled = 'Pick the welcome email template before switching it on.';
  if (enabled && value.milestones.length > 1 && !value.reminder_template_id && !errors.enabled) errors.reminderTemplateId = 'Pick a template for the second email, or leave its days empty.';
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// The two emails, created on first save if missing (Spanish — edit them in Email templates).
export const NO_LISTING_TEMPLATES = [
  {
    key: 'no-listing-welcome', col: 'template_id', name: 'Bienvenida — publicá tu primera propiedad gratis',
    subject: 'Bienvenido a Casa Libre — publicá tu primera propiedad gratis ahora', heading: 'Bienvenido a Casa Libre',
    body: 'Hola {{name}},\n\nGracias por crear tu cuenta en Casa Libre. Todavía no publicaste ninguna propiedad: publicá la primera **gratis** ahora, antes de que sea tarde.\n\nLleva solo unos minutos. Tu propiedad aparece al instante en el mapa y los interesados te escriben directo, sin comisiones.',
    button_label: 'Publicar gratis ahora', button_url: '{{publish_url}}',
  },
  {
    key: 'no-listing-reminder', col: 'reminder_template_id', name: 'Sin publicaciones — recordatorio',
    subject: 'Tu primera publicación gratis te está esperando', heading: 'No te quedes afuera',
    body: 'Hola {{name}},\n\nTe registraste en Casa Libre hace unos días y todavía no publicaste tu propiedad. Tu primera publicación sigue siendo **gratis**: aprovechala ahora, antes de que sea tarde.\n\nSubí tus fotos, marcá la ubicación y listo. Miles de personas buscan propiedades en Casa Libre cada mes.',
    button_label: 'Publicar mi propiedad', button_url: '{{publish_url}}',
  },
];

// Save the card (the API route's PUT). First save: creates the two default emails (unless
// this country already has them, by key), fills the empty template pickers with them, and
// inserts the row. db = lib/db-shaped (select / insert / update).
export async function saveNoListing(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${NO_LISTING_AUTOMATION_ID}&limit=1`);
  const body = { ...input };
  if (!cur) {
    const existing = await db.select('email_templates', 'select=id,key');
    for (const t of NO_LISTING_TEMPLATES) {
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
  const v = validateNoListingSettings(body, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${NO_LISTING_AUTOMATION_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: NO_LISTING_AUTOMATION_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}

// Sent emails per step, from email_log dedupe keys nolisting:<user id>:<step>.
export function noListingStepCounts(logs = []) {
  const per = {};
  for (const l of logs) {
    const m = /^nolisting:[^:]+:(\d+)$/.exec(String(l?.dedupe_key || ''));
    if (m) per[m[1]] = (per[m[1]] || 0) + 1;
  }
  return per;
}
