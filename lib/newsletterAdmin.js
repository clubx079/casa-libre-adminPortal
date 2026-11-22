// "Weekly newsletter" card (Automations page). The website's hourly cron sends it
// (buyer lib/automations/newsletter.js). Row 'weekly_newsletter' (migrations 023 on the website
// seeds it OFF with the 9 newsletter templates); settings in free_tiers[0]:
//   { day 0–6, hour, rotation: [{ template_id, audience }], next, issue }   — the website writes
//   `issue` / `next`; saving here keeps them (only "Start from" changes next).
// Pure helpers + save — test/newsletterAdmin.test.js.
export const NEWSLETTER_ID = 'weekly_newsletter';
export const AUDIENCES = [
  { id: 'everyone', label: 'Everyone (verified accounts)' },
  { id: 'sellers', label: 'Sellers (have listed, or chose seller)' },
  { id: 'buyers', label: 'Buyers (never listed, or chose buyer)' },
  { id: 'never_listed', label: 'Signed up, never listed' },
];
export const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const HOURS = { min: 9, max: 18 };   // messages only go out 09:00–19:00 local (website lib/sendWindow.js)
const AUD = new Set(AUDIENCES.map((a) => a.id));

export function newsletterSettings(row) {
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  const rotation = (Array.isArray(s.rotation) ? s.rotation : []).filter((r) => r && r.template_id)
    .map((r) => ({ template_id: String(r.template_id), audience: AUD.has(r.audience) ? r.audience : 'everyone' }));
  return {
    setUp: !!row,
    enabled: !!(row && row.enabled === true),
    enabledAt: row?.enabled_at || null,
    day: Number.isInteger(s.day) ? s.day : 2,
    hour: Number.isInteger(s.hour) ? s.hour : 10,
    rotation,
    next: Number.isInteger(s.next) && s.next >= 0 && s.next < Math.max(1, rotation.length) ? s.next : 0,
    issue: s.issue && typeof s.issue === 'object' ? { week: s.issue.week, template_id: s.issue.template_id, audience: s.issue.audience, done: !!s.issue.done, started_at: s.issue.started_at || null, skipped: s.issue.skipped || [] } : null,
  };
}

// input = { day, hour, rotation, next, enabled }; current = the row (or null).
export function validateNewsletter(input = {}, row = null, templateIds = [], nowIso = new Date().toISOString()) {
  const cur = newsletterSettings(row);
  const errors = {};
  const day = input.day !== undefined ? Number(input.day) : cur.day;
  const hour = input.hour !== undefined ? Number(input.hour) : cur.hour;
  if (!Number.isInteger(day) || day < 0 || day > 6) errors.day = 'Pick a day.';
  if (!Number.isInteger(hour) || hour < HOURS.min || hour > HOURS.max) errors.hour = `Between ${HOURS.min}:00 and ${HOURS.max}:00 (messages only go out in the daytime).`;
  let rotation = cur.rotation;
  if (input.rotation !== undefined) {
    if (!Array.isArray(input.rotation)) errors.rotation = 'Add at least one template.';
    else {
      const known = new Set(templateIds.map(String));
      rotation = input.rotation.filter((r) => r && r.template_id).map((r) => ({ template_id: String(r.template_id), audience: AUD.has(r.audience) ? r.audience : 'everyone' }));
      if (rotation.length > 30) errors.rotation = 'Up to 30 newsletters in the rotation.';
      if (rotation.some((r) => known.size && !known.has(r.template_id))) errors.rotation = 'A template in the rotation no longer exists.';
    }
  }
  const next = input.next !== undefined ? Number(input.next) : cur.next;
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  if (enabled && !rotation.length) errors.enabled = 'Add at least one newsletter to the rotation before switching it on.';
  const state = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  const value = {
    enabled,
    free_tiers: [{ ...state, day, hour, rotation, next: Number.isInteger(next) && next >= 0 && next < Math.max(1, rotation.length) ? next : 0 }],
  };
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  return { ok: Object.keys(errors).length === 0, value, errors };
}

export async function saveNewsletter(db, input = {}, nowIso = new Date().toISOString()) {
  const [row] = await db.select('automations', `select=*&id=eq.${NEWSLETTER_ID}&limit=1`);
  const templates = await db.select('email_templates', 'select=id,key');
  // first save with no rotation given: every newsletter-… template, in creation order
  const input2 = { ...input };
  if (!row && input2.rotation === undefined) input2.rotation = templates.filter((t) => /^newsletter-/.test(t.key || '')).map((t) => ({ template_id: t.id, audience: 'everyone' }));
  const v = validateNewsletter(input2, row || null, templates.map((t) => t.id), nowIso);
  if (!v.ok) return v;
  if (row) await db.update('automations', `id=eq.${NEWSLETTER_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: NEWSLETTER_ID, wait_days: 0, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !row };
}

// Sent per week, from email_log dedupe keys weekly-newsletter:<week>:<user id>.
export function newsletterWeekCounts(logs = []) {
  const per = {};
  for (const l of logs) {
    const m = /^weekly-newsletter:(\d{4}-W\d{2}):/.exec(String(l?.dedupe_key || ''));
    if (m) per[m[1]] = (per[m[1]] || 0) + 1;
  }
  return per;
}
