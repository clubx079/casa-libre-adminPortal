import 'server-only';
// Email (info@) → Forwarding settings: which email types go to which addresses.
// Saved in the Paraguay DB's `automations` row 'email_forwarding' (free_tiers[0].rules —
// the same no-new-table pattern as Open issues; enabled stays false so no automation runs it).
// Before anything is saved, EMAIL_ALERT_TO (env) gets the important emails.
import { dbFor } from './db';
import { normalizeRules, defaultRules } from './emailTriageCore';

const ROW = 'email_forwarding';
const db = () => dbFor('py');
let cache = null; // { at, value }

export async function readForwarding({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() - cache.at < 60_000) return cache.value;
  let value;
  try {
    const [row] = await db().select('automations', `select=id,free_tiers,updated_at&id=eq.${ROW}&limit=1`);
    const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : null;
    value = s && Array.isArray(s.rules)
      ? { rules: normalizeRules(s.rules), saved: true, updatedAt: row.updated_at || null, updatedBy: s.by || null }
      : { rules: defaultRules(process.env.EMAIL_ALERT_TO || 'omar@airosofts.com'), saved: false };
  } catch {
    value = { rules: defaultRules(process.env.EMAIL_ALERT_TO || 'omar@airosofts.com'), saved: false, error: true };
  }
  cache = { at: Date.now(), value };
  return value;
}

export async function saveForwarding(rules, by = null) {
  const clean = normalizeRules(rules);
  const p = { enabled: false, free_tiers: [{ rules: clean, by }], updated_at: new Date().toISOString() };
  const [row] = await db().select('automations', `select=id&id=eq.${ROW}&limit=1`);
  if (row) await db().update('automations', `id=eq.${ROW}`, p, { returning: 'minimal' });
  else await db().insert('automations', [{ id: ROW, wait_days: 0, ...p }], { returning: 'minimal' });
  cache = null;
  return readForwarding({ fresh: true });
}
