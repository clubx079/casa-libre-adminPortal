// Open issues — one saved list per day (Admin Manager → Open issues → a date), like the reports.
// Runs every 24 h (/api/cron/issues, early morning local time); opening today's list before the
// cron ran — or "Check again" — runs it too. Saved in the country DB's `automations` table as the
// row 'open_issues_day:<yyyy-mm-dd>' (free_tiers[0] = the list; milestones = [open, urgent, total]
// so the list of days needs no big read) — no new table, no DB change. The team's decisions live
// in the 'open_issues' row and are applied when a day is read, so a past day shows what was done.
// Pure helpers tested in test/openIssuesDays.test.js; the rest is server-only I/O (db passed in).
export const DAY_PREFIX = 'open_issues_day:';
export const KEEP_DAYS = 60;
const OFFSET_H = { py: -3, bo: -4, uy: -3, ve: -4, sv: -6 };

// the local calendar day of that country: '2026-11-04'
export const localDay = (country, now = Date.now()) => new Date(now + (OFFSET_H[country] ?? -3) * 3600000).toISOString().slice(0, 10);
export const isDay = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));

// a saved list + the team's decisions since → what the page shows
export function applyState(issues = [], state = {}) {
  return issues.map((i) => {
    if (i.followup) return i;
    const st = state[i.id];
    return st ? { ...i, status: st.state || 'open', handled: { state: st.state, by: st.by || null, at: st.at || null, note: st.note || null } } : { ...i, status: 'open', handled: undefined };
  });
}
export const countsOf = (issues = []) => {
  const open = issues.filter((i) => i.status === 'open');
  return { open: open.length, urgent: open.filter((i) => i.priority === 'urgent').length, total: issues.length };
};

export async function saveDay(db, day, data) {
  const id = `${DAY_PREFIX}${day}`;
  const c = countsOf(data.issues);
  const row = { enabled: false, wait_days: 0, milestones: [c.open, c.urgent, c.total], free_tiers: [{ ...data, day }], updated_at: new Date().toISOString() };
  const [have] = await db.select('automations', `select=id&id=eq.${encodeURIComponent(id)}&limit=1`).catch(() => []);
  if (have) await db.update('automations', `id=eq.${encodeURIComponent(id)}`, row, { returning: 'minimal' });
  else await db.insert('automations', [{ id, ...row }], { returning: 'minimal' });
  // keep KEEP_DAYS
  const cut = new Date(Date.now() - KEEP_DAYS * 86400000).toISOString().slice(0, 10);
  await db.remove?.('automations', `id=like.${encodeURIComponent(`${DAY_PREFIX}%`)}&id=lt.${encodeURIComponent(`${DAY_PREFIX}${cut}`)}`).catch(() => {});
}

export async function readDay(db, day) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${encodeURIComponent(`${DAY_PREFIX}${day}`)}&limit=1`).catch(() => []);
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : null;
  return s;
}

// → [{ day, open, urgent, total, checkedAt }] newest first
export async function listDays(db, limit = 30) {
  const rows = await db.select('automations', `select=id,milestones,updated_at&id=like.${encodeURIComponent(`${DAY_PREFIX}%`)}&order=id.desc&limit=${limit}`).catch(() => []);
  return rows.map((r) => {
    const [open = 0, urgent = 0, total = 0] = Array.isArray(r.milestones) ? r.milestones.map(Number) : [];
    return { day: String(r.id).slice(DAY_PREFIX.length), open, urgent, total, checkedAt: r.updated_at };
  }).filter((d) => isDay(d.day));
}

// the automations rows that are storage, not automations (left out of the report's data)
export const isStorageRow = (id) => /^(open_issues|open_issues_day:|wa_msg_kinds|security_watch|manager_memory)/.test(String(id || ''));
