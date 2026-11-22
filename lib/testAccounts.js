// Test & review accounts marked by hand in Admin → Users ("Mark as test account"), per country.
// They join the team list (lib/internalTraffic.js) and the Pakistan accounts
// (lib/internalAudience.js): never shown in the admin's lists and never counted in any number or
// percentage, in every country. Filter "Test & review accounts" on the Users page shows them.
//
// Stored without a schema change in the country DB's `automations` table, row id 'test_accounts'
// (same pattern as 'alerts_state'): free_tiers[0] = { emails: { "<email>": { at, by } } }.
// The website's automations cron never reads this row (it selects automations by id).
export const TEST_ACCOUNTS_ID = 'test_accounts';

const norm = (e) => String(e || '').trim().toLowerCase();
const stateOf = (row) => {
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return s.emails && typeof s.emails === 'object' ? s.emails : {};
};

// → { "<email>": { at, by } }
export async function readMarked(db) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${TEST_ACCOUNTS_ID}&limit=1`).catch(() => []);
  return stateOf(row);
}

// Pure: the new map after marking (test = true) or unmarking (test = false) one email.
export function applyMark(emails, email, test, by, at = new Date().toISOString()) {
  const e = norm(email);
  const next = { ...(emails || {}) };
  if (!e.includes('@')) return next;
  if (test) next[e] = { at, by: by || null };
  else delete next[e];
  return next;
}

export async function setMarked(db, email, test, by) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${TEST_ACCOUNTS_ID}&limit=1`).catch(() => []);
  const emails = applyMark(stateOf(row), email, test, by);
  const body = { free_tiers: [{ emails }], updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${TEST_ACCOUNTS_ID}`, body, { returning: 'minimal' });
  else await db.insert('automations', [{ id: TEST_ACCOUNTS_ID, enabled: false, wait_days: 0, ...body }], { returning: 'minimal' });
  return emails;
}

// Why an account counts as test / team (for the Users page badge). marked = readMarked() map.
export function testReason(email, { isTeam = false, isPakistan = false, marked = {} } = {}) {
  const e = norm(email);
  if (marked[e]) return { kind: 'marked', label: 'Marked as test', by: marked[e].by || null, at: marked[e].at || null };
  if (isTeam) return { kind: 'team', label: 'Team / review account' };
  if (isPakistan) return { kind: 'pakistan', label: 'Team (Pakistan IP)' };
  return null;
}
