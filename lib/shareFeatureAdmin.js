// "Share feature announcement" — admin side (the website sends it hourly:
// lib/automations/shareFeature.js there, from /api/cron/automations). Emails verified members
// (buyers and sellers) about the share feature, then again every N hours, up to N times
// (0 = no limit), paced per hourly run; test / team accounts never. Rules + the default email:
// lib/shareFeature.js (identical in both repos).
// Settings: the `automations` row 'share_feature_promo' — enabled / enabled_at, template_id and
// free_tiers[0] = { firstAfterHours, everyHours, maxSends, perRun }.
// Nothing is written until an admin saves the card (or migrations/027_share_feature_promo.sql in
// the website repo inserts it); the first save creates the row (off) and the default email.
// Pure except saveShareFeature (db-shaped). Tests: test/shareFeatureAdmin.test.js.
import { SHARE_FEATURE_ID, SHARE_FEATURE_TEMPLATE, SHARE_FEATURE_RANGES, SHARE_FEATURE_STEP_KEY, shareFeatureConfig } from './shareFeature.js';

export { SHARE_FEATURE_ID, SHARE_FEATURE_TEMPLATE, SHARE_FEATURE_DEFAULTS, SHARE_FEATURE_RANGES, shareFeatureConfig, shareFeatureScheduleText } from './shareFeature.js';

const LABEL = {
  firstAfterHours: (a, b) => `Between ${a} and ${b} hours.`,
  everyHours: (a, b) => `Between ${a} and ${b} hours.`,
  maxSends: (a, b) => `Between ${a} and ${b} emails (0 = no limit).`,
  perRun: (a, b) => `Between ${a} and ${b} emails per run.`,
};

// The card's fields → the row. input: { firstAfterHours, everyHours, maxSends, perRun,
// templateId, enabled } (each optional = keep). → { ok, value, errors }
export function validateShareFeature(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = shareFeatureConfig(currentRow);
  const errors = {};
  const settings = {};
  for (const k of ['firstAfterHours', 'everyHours', 'maxSends', 'perRun']) {
    const [min, max] = SHARE_FEATURE_RANGES[k];
    if (input[k] === undefined) { settings[k] = cur[k]; continue; }
    const n = Number(input[k]);
    if (input[k] === '' || input[k] === null || !Number.isInteger(n) || n < min || n > max) { errors[k] = LABEL[k](min, max); settings[k] = cur[k]; } else settings[k] = n;
  }
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
export async function saveShareFeature(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${SHARE_FEATURE_ID}&limit=1`);
  const body = { ...input };
  let templateCreated = false;
  if (!cur || !cur.template_id) {
    let [t] = await db.select('email_templates', `select=id,key&key=eq.${SHARE_FEATURE_TEMPLATE.key}&limit=1`);
    if (!t) { [t] = await db.insert('email_templates', [{ ...SHARE_FEATURE_TEMPLATE, is_active: true }]); templateCreated = true; }
    if (body.templateId === undefined || body.templateId === null || body.templateId === '') body.templateId = t?.id || null;
  }
  const v = validateShareFeature(body, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${SHARE_FEATURE_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: SHARE_FEATURE_ID, wait_days: 0, channel: 'email', ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur, templateCreated };
}

// email_log rows of the automation → { sent, people, last7, stopped }
//   sent = emails that went out · people = different people reached · last7 = sent in the
//   last 7 days · stopped = people stopped by a bounce / spam complaint
export function shareFeatureCounts(logs = [], nowMs = Date.now()) {
  const people = new Set();
  let sent = 0, last7 = 0, stopped = 0;
  for (const l of logs) {
    const key = String(l?.dedupe_key || '');
    if (key.startsWith('sharefeature-stop:')) { stopped++; continue; }
    const m = SHARE_FEATURE_STEP_KEY.exec(key);
    if (!m || !['sent', 'delivered', 'read', 'sending'].includes(l.status)) continue;
    sent++;
    people.add(m[1]);
    if (nowMs - (Date.parse(l.created_at) || 0) <= 7 * 86400e3) last7++;
  }
  return { sent, people: people.size, last7, stopped };
}
