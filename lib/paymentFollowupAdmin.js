// "Waiting for payment → free listing" — admin side (the website runs it hourly:
// lib/automations/paymentFollowup.js there). A listing saved over the free listings of the
// month and never paid ('payment_pending') gets payment reminders, then ONE "this listing is
// on us" email whose button publishes THAT listing for free. Settings = automations row
// 'payment_followup':
//   milestones        reminder steps, HOURS after the listing was saved (1–5 steps, ≤ 30 days)
//   template_id       the reminder email (default: listing-held-payment)
//   wait_days         the gift, DAYS after it was saved (0 = no gift)
//   gift_template_id  the gift email (default: payment-gift, created on the first save)
//   first_tier_count  gifts per person (accounts + listings with the same phone)
//   free_tiers        [{ gift_window_days }] … in this many days (0 = ever) — kept in this json
//                     column because later_free_days must be 1–365
//   free_days         how long a gifted listing stays live (then it ends like a paid one)
// While it is on, "Listing not published" doesn't send its payment message.
// Pure except savePaymentFollowup (db passed in).

export const PAYMENT_FOLLOWUP_ID = 'payment_followup';
export const DEFAULT_STEPS = [24, 72, 168];
export const DEFAULTS = Object.freeze({ giftAfterDays: 8, giftsPerPerson: 1, giftWindowDays: 0, giftDays: 90 });
export const MAX_STEP_HOURS = 720;
export const WINDOW_CHOICES = [[0, 'ever'], [30, 'every 30 days'], [90, 'every 90 days'], [180, 'every 6 months'], [365, 'every year']];

const int = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };
const steps = (m) => [...new Set((Array.isArray(m) ? m : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_STEP_HOURS))].sort((a, b) => a - b).slice(0, 5);

// The row → the card's fields (defaults when there is no row yet).
export function paymentFollowupConfig(row) {
  const pick = (v, min, max, dflt) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : dflt; };
  return {
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    steps: row ? steps(row.milestones) : DEFAULT_STEPS,
    giftAfterDays: pick(row?.wait_days, 0, 60, row ? 0 : DEFAULTS.giftAfterDays),
    giftsPerPerson: pick(row?.first_tier_count, 1, 100, DEFAULTS.giftsPerPerson),
    giftWindowDays: pick(Array.isArray(row?.free_tiers) ? row.free_tiers[0]?.gift_window_days : null, 0, 3650, DEFAULTS.giftWindowDays),
    giftDays: pick(row?.free_days, 1, 365, DEFAULTS.giftDays),
    reminderTemplateId: row?.template_id || '',
    giftTemplateId: row?.gift_template_id || '',
  };
}

export function validatePaymentFollowup(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = paymentFollowupConfig(currentRow);
  const errors = {};
  const raw = input.steps !== undefined ? input.steps : cur.steps;
  const list = (Array.isArray(raw) ? raw : []).map(int);
  if (list.some((n) => !Number.isInteger(n) || n < 1 || n > MAX_STEP_HOURS)) errors.steps = `Each reminder between 1 hour and ${MAX_STEP_HOURS / 24} days.`;
  else if (list.length > 5) errors.steps = 'At most 5 reminders.';
  const stepHours = errors.steps ? cur.steps : steps(list);
  const giftAfterDays = input.giftAfterDays !== undefined && input.giftAfterDays !== '' ? int(input.giftAfterDays) : (input.giftAfterDays === '' ? 0 : cur.giftAfterDays);
  if (!Number.isInteger(giftAfterDays) || giftAfterDays < 0 || giftAfterDays > 60) errors.giftAfterDays = '0 to 60 days (0 = no gift).';
  else if (giftAfterDays > 0 && stepHours.length && giftAfterDays * 24 <= stepHours[stepHours.length - 1]) errors.giftAfterDays = `Send the gift after the last reminder (${Math.ceil(stepHours[stepHours.length - 1] / 24)} days or more).`;
  const giftsPerPerson = input.giftsPerPerson !== undefined ? int(input.giftsPerPerson) : cur.giftsPerPerson;
  if (!Number.isInteger(giftsPerPerson) || giftsPerPerson < 1 || giftsPerPerson > 100) errors.giftsPerPerson = '1 to 100.';
  const giftWindowDays = input.giftWindowDays !== undefined ? int(input.giftWindowDays) : cur.giftWindowDays;
  if (!WINDOW_CHOICES.some(([d]) => d === giftWindowDays)) errors.giftWindowDays = 'Pick one of the options.';
  const giftDays = input.giftDays !== undefined ? int(input.giftDays) : cur.giftDays;
  if (!Number.isInteger(giftDays) || giftDays < 1 || giftDays > 365) errors.giftDays = '1 to 365 days.';
  const reminderTemplateId = input.reminderTemplateId !== undefined ? String(input.reminderTemplateId || '') : cur.reminderTemplateId;
  const giftTemplateId = input.giftTemplateId !== undefined ? String(input.giftTemplateId || '') : cur.giftTemplateId;
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  if (enabled && !reminderTemplateId && !(giftAfterDays > 0 && giftTemplateId)) errors.enabled = 'Pick the reminder email (or a gift email) before switching it on.';
  if (giftAfterDays > 0 && !giftTemplateId && !errors.giftAfterDays) errors.giftTemplateId = 'Pick the gift email, or set the gift to 0 days (no gift).';
  const value = {
    milestones: stepHours, template_id: reminderTemplateId || null, gift_template_id: giftTemplateId || null,
    wait_days: Number.isInteger(giftAfterDays) ? giftAfterDays : cur.giftAfterDays,
    first_tier_count: Number.isInteger(giftsPerPerson) ? giftsPerPerson : cur.giftsPerPerson,
    free_tiers: [{ gift_window_days: Number.isInteger(giftWindowDays) ? giftWindowDays : cur.giftWindowDays }],
    free_days: Number.isInteger(giftDays) ? giftDays : cur.giftDays,
    enabled,
  };
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// The gift email (Spanish — edit it in Templates). {{claim_url}} publishes that listing for free.
export const GIFT_TEMPLATE = {
  key: 'payment-gift', name: 'Publicación gratis — regalo (falta el pago)',
  subject: 'Esta va por nuestra cuenta: publicá tu propiedad gratis', heading: 'Te regalamos esta publicación',
  body: 'Hola {{name}},\n\nVimos que tu publicación **{{property_title}}** quedó guardada sin publicar. Queremos que la vean los compradores, así que **esta va por nuestra cuenta**: publicala gratis y queda visible {{gift_days}} días.\n\nSolo tocá el botón. El regalo vale hasta el {{offer_until}}.',
  button_label: 'Publicar gratis', button_url: '{{claim_url}}',
};
// Used if this country doesn't have the "Listing not published" payment email yet.
export const REMINDER_TEMPLATE = {
  key: 'listing-held-payment', name: 'Publicación no publicada — falta el pago',
  subject: 'Tu publicación está guardada, falta un paso para publicarla', heading: 'Tu publicación todavía no está visible',
  body: 'Hola {{name}},\n\nTu publicación **{{property_title}}** está guardada pero todavía no aparece en Casa Libre: ya usaste tus {{free_limit}} publicaciones gratis de este mes.\n\nPodés publicarla ahora por **{{price}}** y queda visible {{paid_days}} días. Entrá a Mis publicaciones y tocá "Pagar y publicar".',
  button_label: 'Publicar ahora', button_url: '{{my_listings_url}}',
};

// Save the card. First save: the two emails (unless this country has them, by key) are
// created and picked, and the row is inserted.
export async function savePaymentFollowup(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${PAYMENT_FOLLOWUP_ID}&limit=1`);
  const patch = { ...input };
  if (!cur) {
    const existing = await db.select('email_templates', 'select=id,key');
    const ensure = async (t) => {
      const have = existing.find((e) => e.key === t.key);
      if (have) return have.id;
      const [made] = await db.insert('email_templates', [{ ...t, is_active: true }]);
      return made?.id || '';
    };
    const remId = await ensure(REMINDER_TEMPLATE);
    const giftId = await ensure(GIFT_TEMPLATE);
    if (!patch.reminderTemplateId) patch.reminderTemplateId = remId;
    if (!patch.giftTemplateId) patch.giftTemplateId = giftId;
    if (patch.giftAfterDays === undefined) patch.giftAfterDays = DEFAULTS.giftAfterDays;
    if (patch.steps === undefined) patch.steps = DEFAULT_STEPS;
  }
  const v = validatePaymentFollowup(patch, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${PAYMENT_FOLLOWUP_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: PAYMENT_FOLLOWUP_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}

// Sent reminders per step + gifts, from email_log dedupe keys payrem:<id>:<step> / paygift:<id>.
export function paymentFollowupCounts(logs = []) {
  const perStep = {};
  let gifts = 0;
  for (const l of logs) {
    const k = String(l?.dedupe_key || '');
    const m = /^payrem:[^:]+:(\d+)$/.exec(k);
    if (m) perStep[m[1]] = (perStep[m[1]] || 0) + 1;
    else if (/^paygift:[^:]+$/.test(k)) gifts++;
  }
  return { perStep, reminders: Object.values(perStep).reduce((a, b) => a + b, 0), gifts };
}
