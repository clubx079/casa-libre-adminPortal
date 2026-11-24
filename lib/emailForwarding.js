import 'server-only';
// Email (info@) → Settings: (1) Forwarding — which email types go to which addresses; (2) Sidebar
// badge — which types count in the unread number next to "Email (info@)" in the sidebar.
// Saved in the Paraguay DB's `automations` row 'email_forwarding' (free_tiers[0] = { rules, badge, by }
// — the same no-new-table pattern as Open issues; enabled stays false so no automation runs it).
// Before anything is saved: EMAIL_ALERT_TO (env) gets the important emails, and the badge counts
// Important only.
import { dbFor } from './db';
import { normalizeRules, defaultRules, normalizeBadge, DEFAULT_BADGE } from './emailTriageCore';

const ROW = 'email_forwarding';
const db = () => dbFor('py');
const G = (globalThis.__clEmailSettings ||= { cache: null });   // { at, value }

const defaults = (extra = {}) => ({ rules: defaultRules(process.env.EMAIL_ALERT_TO || 'omar@airosofts.com'), badge: [...DEFAULT_BADGE], saved: false, ...extra });

export async function readForwarding({ fresh = false } = {}) {
  if (!fresh && G.cache && Date.now() - G.cache.at < 60_000) return G.cache.value;
  let value;
  try {
    const [row] = await db().select('automations', `select=id,free_tiers,updated_at&id=eq.${ROW}&limit=1`);
    const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : null;
    value = s && Array.isArray(s.rules)
      ? { rules: normalizeRules(s.rules), badge: normalizeBadge(s.badge), saved: true, updatedAt: row.updated_at || null, updatedBy: s.by || null }
      : defaults();
  } catch {
    value = defaults({ error: true });
  }
  G.cache = { at: Date.now(), value };
  return value;
}

// Saves both settings; a part left out keeps its saved value.
export async function saveForwarding(rules, by = null, badge = undefined) {
  const cur = await readForwarding({ fresh: true });
  const clean = rules === undefined ? cur.rules : normalizeRules(rules);
  const b = badge === undefined ? cur.badge : normalizeBadge(badge);
  const p = { enabled: false, free_tiers: [{ rules: clean, badge: b, by }], updated_at: new Date().toISOString() };
  const [row] = await db().select('automations', `select=id&id=eq.${ROW}&limit=1`);
  if (row) await db().update('automations', `id=eq.${ROW}`, p, { returning: 'minimal' });
  else await db().insert('automations', [{ id: ROW, wait_days: 0, ...p }], { returning: 'minimal' });
  G.cache = null;
  return readForwarding({ fresh: true });
}
