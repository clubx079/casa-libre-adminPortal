// "Share your listing" — the two Automations cards (admin side; the website sends the emails and
// grants the reward from its hourly cron, the app and the website show the share sheet).
// Settings live in each country DB's `automations` table (no DDL, no table of their own):
//
//   row 'share_nudge'  (emails that ask the owner to share their live listing)
//     enabled / enabled_at
//     milestones            HOURS after the listing went live, one email each (1–5), default [24, 168]
//     template_id           the "share your listing" email  (default template key share-nudge-published)
//     reminder_template_id  the low-views email              (default template key share-nudge-lowviews)
//     free_tiers[0]         { lowViews: { enabled, threshold, afterHours } } — a listing with fewer
//                           than `threshold` views `afterHours` after going live gets the low-views
//                           email once (default on, 10 views, 72 h)
//
//   row 'share_reward' (visits through the owner's share links earn a reward, once per listing)
//     enabled (OFF until an admin switches it on) / enabled_at
//     free_tiers[0]         { visits: 20, reward: 'verified' | 'home', days: 3, perListingOnce: true }
//     template_id           the "you earned it" email (default template key share-reward-earned)
//   Each reward granted is an email_log row with automation_id 'share_reward' (granted through the
//   referral program's grant functions on the website).
//
// Nothing is written until an admin saves a card; the first save creates the row (off unless the
// card says on) and the default Spanish emails (unless the country already has them, by key).
// Pure helpers + the two save functions (db = lib/db-shaped) — test/shareAdmin.test.js.

export const SHARE_NUDGE_ID = 'share_nudge';
export const SHARE_REWARD_ID = 'share_reward';
export const SHARE_NUDGE_DEFAULT_STEPS = [24, 168];
export const SHARE_STEPS = { max: 5, minHours: 1, maxHours: 60 * 24 };
export const LOW_VIEWS_DEFAULT = { enabled: true, threshold: 10, afterHours: 72 };
export const LOW_VIEWS_LIMITS = { minThreshold: 1, maxThreshold: 10000, minHours: 1, maxHours: 60 * 24 };
export const SHARE_REWARD_DEFAULT = { visits: 20, reward: 'verified', days: 3, perListingOnce: true };
export const SHARE_REWARD_LIMITS = { minVisits: 1, maxVisits: 100000, minDays: 1, maxDays: 365 };
export const REWARD_TYPES = [
  { id: 'verified', label: 'Verified badge' },
  { id: 'home', label: 'Home-page spot (with the Verified badge)' },
];

const tier0 = (row) => (row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {});
const int = (v) => (v === '' || v == null ? NaN : Number(v));
const inRange = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
const normalizeSteps = (m) => [...new Set((Array.isArray(m) ? m : []).map(Number)
  .filter((n) => inRange(n, SHARE_STEPS.minHours, SHARE_STEPS.maxHours)))].sort((a, b) => a - b).slice(0, SHARE_STEPS.max);

export const shareStepFromHours = (h) => (Number(h) > 0 && Number(h) % 24 === 0 ? { value: Number(h) / 24, unit: 'days' } : { value: Number(h), unit: 'hours' });
export const shareStepToHours = (s) => (s && s.value !== '' && s.value != null ? Number(s.value) * (s.unit === 'days' ? 24 : 1) : NaN);
const span = (h) => {
  const s = shareStepFromHours(h);
  return `${s.value} ${s.unit === 'days' ? (s.value === 1 ? 'day' : 'days') : (s.value === 1 ? 'hour' : 'hours')}`;
};
// "1 day after the listing went live"
export const shareStepLabel = (h) => `${span(h)} after the listing went live`;

// ── share nudges ─────────────────────────────────────────────────────────────────────────────
export function shareNudgeConfig(row) {
  const steps = Array.isArray(row?.milestones) ? normalizeSteps(row.milestones) : [];
  const lv = tier0(row).lowViews && typeof tier0(row).lowViews === 'object' ? tier0(row).lowViews : {};
  return {
    setUp: !!row,
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    steps: steps.length ? steps : [...SHARE_NUDGE_DEFAULT_STEPS],
    templateId: row?.template_id || '',
    lowViewsTemplateId: row?.reminder_template_id || '',
    lowViews: {
      enabled: lv.enabled === undefined ? LOW_VIEWS_DEFAULT.enabled : lv.enabled === true,
      threshold: inRange(Number(lv.threshold), LOW_VIEWS_LIMITS.minThreshold, LOW_VIEWS_LIMITS.maxThreshold) ? Number(lv.threshold) : LOW_VIEWS_DEFAULT.threshold,
      afterHours: inRange(Number(lv.afterHours), LOW_VIEWS_LIMITS.minHours, LOW_VIEWS_LIMITS.maxHours) ? Number(lv.afterHours) : LOW_VIEWS_DEFAULT.afterHours,
    },
  };
}

// input = { enabled?, steps? (hours), templateId?, lowViewsTemplateId?, lowViews?: { enabled?, threshold?, afterHours? } }
// → { ok, value (the row's columns), errors }
export function validateShareNudge(input = {}, row = null, nowIso = new Date().toISOString()) {
  const cur = shareNudgeConfig(row);
  const errors = {};
  let steps = cur.steps;
  if (input.steps !== undefined) {
    const raw = Array.isArray(input.steps) ? input.steps : [];
    if (!raw.length) errors.steps = 'Add at least one email.';
    else if (raw.length > SHARE_STEPS.max) errors.steps = `At most ${SHARE_STEPS.max} emails.`;
    raw.forEach((h, i) => {
      if (!inRange(int(h), SHARE_STEPS.minHours, SHARE_STEPS.maxHours)) errors[`step_${i}`] = 'From 1 hour to 60 days after the listing went live.';
    });
    const clean = normalizeSteps(raw);
    if (!Object.keys(errors).length && clean.length !== raw.length) errors.steps = 'Two emails can’t go out at the same time.';
    if (!Object.keys(errors).length) steps = clean;
  }
  const lvIn = input.lowViews && typeof input.lowViews === 'object' ? input.lowViews : {};
  const lowViews = { ...cur.lowViews };
  if (lvIn.enabled !== undefined) lowViews.enabled = !!lvIn.enabled;
  if (lvIn.threshold !== undefined) {
    const n = int(lvIn.threshold);
    if (!inRange(n, LOW_VIEWS_LIMITS.minThreshold, LOW_VIEWS_LIMITS.maxThreshold)) errors.lowViewsThreshold = 'A whole number of views, 1 or more.';
    else lowViews.threshold = n;
  }
  if (lvIn.afterHours !== undefined) {
    const n = int(lvIn.afterHours);
    if (!inRange(n, LOW_VIEWS_LIMITS.minHours, LOW_VIEWS_LIMITS.maxHours)) errors.lowViewsAfterHours = 'From 1 hour to 60 days.';
    else lowViews.afterHours = n;
  }
  const pick = (k, col) => (input[k] !== undefined ? (input[k] || null) : (row?.[col] ?? null));
  const value = {
    milestones: steps,
    wait_days: 0,
    template_id: pick('templateId', 'template_id'),
    reminder_template_id: pick('lowViewsTemplateId', 'reminder_template_id'),
    free_tiers: [{ ...tier0(row), lowViews }],
  };
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  if (enabled && !value.template_id) errors.enabled = 'Pick the "share your listing" email before switching it on.';
  if (enabled && lowViews.enabled && !value.reminder_template_id) errors.enabled = 'Pick the low-views email (or switch the low-views email off) before switching it on.';
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// ── share reward ─────────────────────────────────────────────────────────────────────────────
export function shareRewardConfig(row) {
  const t = tier0(row);
  return {
    setUp: !!row,
    enabled: row?.enabled === true,
    enabledAt: row?.enabled_at || null,
    visits: inRange(Number(t.visits), SHARE_REWARD_LIMITS.minVisits, SHARE_REWARD_LIMITS.maxVisits) ? Number(t.visits) : SHARE_REWARD_DEFAULT.visits,
    reward: REWARD_TYPES.some((r) => r.id === t.reward) ? t.reward : SHARE_REWARD_DEFAULT.reward,
    days: inRange(Number(t.days), SHARE_REWARD_LIMITS.minDays, SHARE_REWARD_LIMITS.maxDays) ? Number(t.days) : SHARE_REWARD_DEFAULT.days,
    perListingOnce: t.perListingOnce === undefined ? SHARE_REWARD_DEFAULT.perListingOnce : t.perListingOnce !== false,
    templateId: row?.template_id || '',
  };
}

// input = { enabled?, visits?, reward?, days?, templateId? } → { ok, value, errors }
export function validateShareReward(input = {}, row = null, nowIso = new Date().toISOString()) {
  const cur = shareRewardConfig(row);
  const errors = {};
  const num = (k, lo, hi, msg) => {
    if (input[k] === undefined) return cur[k];
    const n = int(input[k]);
    if (!inRange(n, lo, hi)) { errors[k] = msg; return cur[k]; }
    return n;
  };
  const visits = num('visits', SHARE_REWARD_LIMITS.minVisits, SHARE_REWARD_LIMITS.maxVisits, 'A whole number of visits, 1 or more.');
  const days = num('days', SHARE_REWARD_LIMITS.minDays, SHARE_REWARD_LIMITS.maxDays, 'From 1 to 365 days.');
  let reward = cur.reward;
  if (input.reward !== undefined) {
    if (REWARD_TYPES.some((r) => r.id === input.reward)) reward = input.reward;
    else errors.reward = 'Pick the Verified badge or the home-page spot.';
  }
  const value = {
    wait_days: 0,
    // perListingOnce stays true: one reward per listing, whatever the visits after it
    free_tiers: [{ ...tier0(row), visits, reward, days, perListingOnce: true }],
    template_id: input.templateId !== undefined ? (input.templateId || null) : (row?.template_id ?? null),
  };
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  if (enabled && !value.template_id) errors.enabled = 'Pick the "you earned it" email before switching it on.';
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// "20 visits through your share links → 3 days of the Verified badge, once per listing"
export function shareRewardText(cfg) {
  const what = cfg.reward === 'home' ? 'on the home page (with the Verified badge)' : 'of the Verified badge';
  return `${cfg.visits} ${cfg.visits === 1 ? 'visit' : 'visits'} through the owner's share links → ${cfg.days} ${cfg.days === 1 ? 'day' : 'days'} ${what}, once per listing`;
}

// ── default emails (Spanish; edit them in Email templates). Brand written "Casa-Libre". ──────
// Placeholders the website fills: {{name}}, {{listing_title}}, {{share_url}} (the listing's share
// page / sheet), {{listing_url}}, {{views}}, {{visits_needed}}, {{reward_text}}, {{reward_days}}.
export const SHARE_NUDGE_TEMPLATES = [
  {
    key: 'share-nudge-published', col: 'template_id', name: 'Compartí tu publicación',
    subject: 'Compartí tu publicación y llegá a más interesados',
    heading: 'Tu propiedad ya está en Casa-Libre: compartila',
    body: 'Hola {{name}},\n\nTu publicación «{{listing_title}}» ya está en Casa-Libre. Compartirla en WhatsApp, Instagram o Facebook es la forma más rápida de que más personas la vean: cada persona que entra por tu link ve tu propiedad y te escribe directo a tu WhatsApp.\n\nCompartila en un minuto desde la web o desde la app de Casa-Libre para iPhone y Android.',
    button_label: 'Compartir mi publicación', button_url: '{{share_url}}',
  },
  {
    key: 'share-nudge-lowviews', col: 'reminder_template_id', name: 'Pocas visitas — compartí tu publicación',
    subject: 'Tu publicación puede llegar a más personas',
    heading: 'Más visitas con un solo link',
    body: 'Hola {{name}},\n\nTu publicación «{{listing_title}}» tiene {{views}} visitas hasta ahora. Las propiedades que sus dueños comparten en WhatsApp, Instagram o Facebook reciben más visitas y más consultas.\n\nCompartila desde la web o desde la app de Casa-Libre para iPhone y Android: los interesados te escriben directo a tu WhatsApp.',
    button_label: 'Compartir mi publicación', button_url: '{{share_url}}',
  },
];
export const SHARE_REWARD_TEMPLATE = {
  key: 'share-reward-earned', col: 'template_id', name: 'Compartiste y ganaste',
  subject: '¡Ganaste {{reward_text}} en Casa-Libre!',
  heading: 'Gracias por compartir tu publicación',
  body: 'Hola {{name}},\n\n{{visits_needed}} personas entraron a «{{listing_title}}» por los links que compartiste. Como agradecimiento, tu publicación tiene {{reward_text}} durante {{reward_days}} días.\n\nSeguí compartiendo desde la web o desde la app de Casa-Libre para iPhone y Android.',
  button_label: 'Ver mi publicación', button_url: '{{listing_url}}',
};

// Missing default templates (by key) are created; → { key → id }.
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

async function upsert(db, id, cur, value, nowIso) {
  if (cur) await db.update('automations', `id=eq.${id}`, { ...value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id, ...value, updated_at: nowIso }], { returning: 'minimal' });
}

// Save the "Share nudges" card. First save: default emails + the row.
export async function saveShareNudge(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${SHARE_NUDGE_ID}&limit=1`);
  const body = { ...input };
  if (!cur) {
    const ids = await ensureTemplates(db, SHARE_NUDGE_TEMPLATES);
    if (!body.templateId) body.templateId = ids['share-nudge-published'];
    if (!body.lowViewsTemplateId) body.lowViewsTemplateId = ids['share-nudge-lowviews'];
  }
  const v = validateShareNudge(body, cur || null, nowIso);
  if (!v.ok) return v;
  await upsert(db, SHARE_NUDGE_ID, cur, v.value, nowIso);
  return { ...v, created: !cur };
}

// Save the "Share reward" card. First save: the default email + the row (off unless switched on).
export async function saveShareReward(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${SHARE_REWARD_ID}&limit=1`);
  const body = { ...input };
  if (!cur) {
    const ids = await ensureTemplates(db, [SHARE_REWARD_TEMPLATE]);
    if (!body.templateId) body.templateId = ids['share-reward-earned'];
  }
  const v = validateShareReward(body, cur || null, nowIso);
  if (!v.ok) return v;
  await upsert(db, SHARE_REWARD_ID, cur, v.value, nowIso);
  return { ...v, created: !cur };
}

// Sent nudge emails: { published: n, lowViews: n } from email_log rows (template_key, or the
// template ids of the row when the key is missing).
export function shareNudgeCounts(logs = [], cfg = {}) {
  let published = 0; let lowViews = 0;
  for (const l of logs) {
    const k = String(l?.template_key || '');
    if (k === 'share-nudge-lowviews' || (cfg.lowViewsTemplateId && String(l?.template_id) === String(cfg.lowViewsTemplateId))) lowViews++;
    else published++;
  }
  return { published, lowViews, sent: published + lowViews };
}
