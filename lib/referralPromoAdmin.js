// "Promote the referral program" — admin side (the website sends it hourly:
// lib/automations/referralPromo.js there, from /api/cron/automations). Emails verified
// members about the referral program with their own link: first N hours after sign-up,
// then every N days, up to a maximum; people who signed up before it was switched on too
// (optional), paced per hourly run. Rules + the default email: lib/referrals/promo.js
// (identical in both repos).
// Settings: the `automations` row 'referral_promo' — enabled / enabled_at, template_id and
// free_tiers[0] = { firstAfterHours, everyDays, maxSends, includeExisting, perRun }.
// Nothing is written until an admin saves the card (or scripts/seed-referral-promo.mjs in
// the website repo inserts it); the first save creates the row and the default email.
// Pure except saveReferralPromo (db-shaped). Tests: test/referralPromoAdmin.test.js.
import { PROMO_ID, PROMO_TEMPLATE, PROMO_RANGES, promoConfig, PROMO_STEP_KEY } from './referrals/promo.js';

export { PROMO_ID, PROMO_TEMPLATE, PROMO_DEFAULTS, PROMO_RANGES, promoConfig, promoScheduleText } from './referrals/promo.js';

const LABEL = {
  firstAfterHours: (a, b) => `Between ${a} and ${b} hours.`,
  everyDays: (a, b) => `Between ${a} and ${b} days.`,
  maxSends: (a, b) => `Between ${a} and ${b} emails.`,
  perRun: (a, b) => `Between ${a} and ${b} emails per run.`,
};

// The card's fields → the row. input: { firstAfterHours, everyDays, maxSends, includeExisting,
// perRun, templateId, enabled } (each optional = keep). → { ok, value, errors }
export function validatePromoSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = promoConfig(currentRow);
  const errors = {};
  const settings = {};
  for (const k of ['firstAfterHours', 'everyDays', 'maxSends', 'perRun']) {
    const [min, max] = PROMO_RANGES[k];
    if (input[k] === undefined || input[k] === '') { settings[k] = cur[k]; if (input[k] === '') errors[k] = LABEL[k](min, max); continue; }
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) { errors[k] = LABEL[k](min, max); settings[k] = cur[k]; } else settings[k] = n;
  }
  settings.includeExisting = input.includeExisting === undefined ? cur.includeExisting : !!input.includeExisting;
  const value = {
    free_tiers: [settings],
    template_id: input.templateId !== undefined ? (input.templateId || null) : (currentRow?.template_id ?? null),
  };
  const enabled = input.enabled !== undefined ? !!input.enabled : currentRow?.enabled === true;
  value.enabled = enabled;
  if (enabled && currentRow?.enabled !== true) value.enabled_at = nowIso;
  if (enabled && !value.template_id) errors.enabled = 'Pick the email template before switching it on.';
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// Save the card (the API route's PUT). First save: creates the default email (unless this
// country already has it, by key), picks it, and inserts the row. db = lib/db-shaped.
export async function saveReferralPromo(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${PROMO_ID}&limit=1`);
  const body = { ...input };
  let templateCreated = false;
  if (!cur || !cur.template_id) {
    let [t] = await db.select('email_templates', `select=id,key&key=eq.${PROMO_TEMPLATE.key}&limit=1`);
    if (!t) { [t] = await db.insert('email_templates', [{ ...PROMO_TEMPLATE, is_active: true }]); templateCreated = true; }
    if (body.templateId === undefined || body.templateId === null || body.templateId === '') body.templateId = t?.id || null;
  }
  const v = validatePromoSettings(body, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${PROMO_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: PROMO_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur, templateCreated };
}

// email_log rows of the automation → { sent, people, perStep: { 1: n, 2: n … }, optedOut, bounced }
export function promoCounts(logs = []) {
  const perStep = {};
  const people = new Set();
  let sent = 0, optedOut = 0, bounced = 0;
  for (const l of logs) {
    const key = String(l?.dedupe_key || '');
    if (key.startsWith('refpromo-stop:')) { if (l.subject === 'unsubscribed') optedOut++; else bounced++; continue; }
    const m = PROMO_STEP_KEY.exec(key);
    if (!m || key.endsWith(':wa') || !['sent', 'delivered', 'read', 'sending'].includes(l.status)) continue;
    sent++;
    people.add(m[1]);
    perStep[m[2]] = (perStep[m[2]] || 0) + 1;
  }
  return { sent, people: people.size, perStep, optedOut, bounced };
}
