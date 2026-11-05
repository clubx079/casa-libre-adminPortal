// Security watch — the IP detector (Admin Manager; hourly cron /api/cron/security).
// History: AI Operations Plan step 5 (Roland, 2 Nov) blocked all of Africa at the website and
// suspended accounts by region. User, Nov 6 2026: lift the Africa block; instead detect the ONE
// suspicious IP and block only that IP, and report it in the Admin Manager's weekly report.
//   detector   per IP, the last 24 h of website events (PostHog, browser events only):
//              an IP is suspicious when it fires ≥ the threshold of events — abroad
//              (default 500) or from the home country (default 2,000, a busy office / phone
//              network is normal there) — AND looks like one machine, not a shared network:
//              at least EVENTS_PER_VISITOR events per distinct visitor on it.
//   block      a suspicious IP goes on the blocked list for `blockDays` (default 30); the
//              website turns it away (website lib/ipBlock.js + middleware). An admin can
//              unblock it in Admin Manager → Security (it is then never blocked again by itself)
//              or block an IP by hand.
//   accounts   a new account (last 30 days) that signed up from a blocked IP is suspended and
//              told by email (reply if it's a mistake) → Open issues: keep or lift. Never the
//              team, never one already suspended, never one an admin lifted.
//              SECURITY_AUTO_SUSPEND=0 → report only (no blocks, no suspensions).
//   region     only when GEO_BLOCK is set (e.g. "africa"): the old region rules still work, off by default.
// Everything lives in the `automations` row 'security_watch', free_tiers[0]:
//   { settings: { abroadEvents, homeEvents, blockDays }, blocked_ips: [...], suspensions: [...] }
// Pure parts tested in test/securityWatch.test.js.
export const WATCH_ID = 'security_watch';
export const IP_EVENTS_DEFAULT = 500;
export const DEFAULT_SETTINGS = Object.freeze({ abroadEvents: IP_EVENTS_DEFAULT, homeEvents: 2000, blockDays: 30 });
export const EVENTS_PER_VISITOR = 100;   // a shared network: many visitors, a few dozen events each
const D = 86400000;

// ISO codes of the (optional) region block — same list as the website's lib/geoBlock.js
export const AFRICA = ['DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW', 'EH', 'RE', 'YT', 'SH'];
// GEO_BLOCK: unset / 'off' → no country is blocked (since Nov 6 2026) · a list of ISO codes and/or 'africa'
export function blockedCountries(setting) {
  const raw = setting === undefined || setting === null ? 'off' : String(setting).trim();
  if (!raw || /^(off|none|0|false)$/i.test(raw)) return new Set();
  const out = new Set();
  for (const part of raw.split(/[\s,]+/).filter(Boolean)) {
    if (/^africa$/i.test(part)) AFRICA.forEach((c) => out.add(c));
    else if (/^[a-z]{2}$/i.test(part)) out.add(part.toUpperCase());
  }
  return out;
}
// African calling codes: +20, +27, +211…+269, +290, +291 (only checked while Africa is blocked)
export function africanPhone(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return /^(20|27|2[1-6]\d|29[01])\d{6,}$/.test(d);
}

// the admin's thresholds (Admin Manager → Security), anything missing or odd → the default
export function normSettings(s = {}) {
  const int = (v, def, min, max) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= min && n <= max ? n : def; };
  return {
    abroadEvents: int(s.abroadEvents, DEFAULT_SETTINGS.abroadEvents, 50, 100000),
    homeEvents: int(s.homeEvents, DEFAULT_SETTINGS.homeEvents, 50, 100000),
    blockDays: int(s.blockDays, DEFAULT_SETTINGS.blockDays, 1, 365),
  };
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
export const validIp = (ip) => {
  const s = String(ip || '').trim();
  const m = s.match(IPV4);
  if (m) return m.slice(1).every((x) => Number(x) <= 255);
  return /^[0-9a-f:]+$/i.test(s) && s.includes(':') && s.length <= 45;
};

// rows: [{ ip, country (ISO), countryName, events, visitors }] (24 h, per IP) · homeCountry 'PY'
// → Map(ip → { reason, ipCountry, events, visitors })
export function flaggedIps(rows = [], { blocked = new Set(), homeCountry = 'PY', minEvents = IP_EVENTS_DEFAULT, homeMinEvents = DEFAULT_SETTINGS.homeEvents, allowed = new Set() } = {}) {
  const out = new Map();
  for (const r of rows) {
    const ip = String(r.ip || '').trim();
    if (!ip || ip === '?' || allowed.has(ip)) continue;
    const cc = String(r.country || '').toUpperCase();
    const events = Number(r.events) || 0;
    const visitors = Math.max(1, Number(r.visitors) || 1);
    const where = r.countryName || cc || 'an unknown country';
    if (cc && blocked.has(cc)) { out.set(ip, { reason: `Visited from ${where} (blocked region)`, ipCountry: where, events, visitors }); continue; }
    const home = cc && cc === String(homeCountry).toUpperCase();
    const limit = home ? homeMinEvents : minEvents;
    if (events >= limit && events / visitors >= EVENTS_PER_VISITOR) {
      out.set(ip, { reason: `One IP fired ${events.toLocaleString('en-US')} events in 24 h from ${where}${visitors > 1 ? ` (${visitors} visitors)` : ''} — over the ${limit.toLocaleString('en-US')} limit`, ipCountry: where, events, visitors });
    }
  }
  return out;
}

// the blocked list → the IPs blocked right now
export const activeBlocks = (list = [], now = Date.now()) => list.filter((b) => !b.unblocked && Date.parse(b.until || 0) > now);
// IPs an admin unblocked: the detector leaves them alone from then on
export const allowedIps = (list = []) => new Set(list.filter((b) => b.unblocked).map((b) => String(b.ip)));

// flagged (Map from flaggedIps) → the new entries to add to the blocked list
export function ipsToBlock(flagged = new Map(), list = [], { now = Date.now(), days = DEFAULT_SETTINGS.blockDays } = {}) {
  const active = new Set(activeBlocks(list, now).map((b) => String(b.ip)));
  const allowed = allowedIps(list);
  const out = [];
  for (const [ip, v] of flagged) {
    if (active.has(ip) || allowed.has(ip)) continue;
    out.push({ ip, reason: v.reason, country: v.ipCountry || null, events: v.events || 0, visitors: v.visitors || null, at: new Date(now).toISOString(), until: new Date(now + days * D).toISOString(), by: 'security watch' });
  }
  return out;
}

// users: new accounts (last 30 days) → the ones to suspend now, with the reason
export function toSuspend(users = [], { ips = new Map(), blocked = new Set(), already = [], isInternal = () => false } = {}) {
  const lifted = new Set(already.filter((s) => s.lifted).map((s) => String(s.user_id)));
  const known = new Set(already.map((s) => String(s.user_id)));
  const out = [];
  for (const u of users) {
    if (u.suspended || u.blocked || isInternal(u.email) || lifted.has(String(u.id)) || known.has(String(u.id))) continue;
    const hit = ips.get(String(u.registration_ip || '')) || ips.get(String(u.ip_address || ''));
    if (hit) { out.push({ user: u, reason: hit.reason, ip: u.registration_ip || u.ip_address, ipCountry: hit.ipCountry }); continue; }
    if (blocked.has('NG') && africanPhone(u.phone)) out.push({ user: u, reason: `WhatsApp number +${String(u.phone).replace(/\D/g, '').slice(0, 3)} is from a blocked region`, ip: u.registration_ip || null, ipCountry: null });
  }
  return out;
}

export const SUSPENDED_EMAIL = {
  subject: 'Tu cuenta de Casa-Libre está suspendida',
  text: (name) => `Hola${name ? ` ${String(name).trim().split(/\s+/)[0]}` : ''},\n\nSuspendimos tu cuenta de Casa-Libre porque detectamos actividad inusual. Casa-Libre es un marketplace de propiedades para América Latina.\n\nSi creés que es un error, respondé este correo y lo revisamos.\n\nEl equipo de Casa-Libre`,
};

// ── storage: one object in automations 'security_watch' free_tiers[0] ──
export async function readWatch(db) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${WATCH_ID}&limit=1`).catch(() => []);
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return {
    settings: normSettings(s.settings || {}),
    blocked_ips: Array.isArray(s.blocked_ips) ? s.blocked_ips : [],
    suspensions: Array.isArray(s.suspensions) ? s.suspensions : [],
  };
}
// patch: any of { settings, blocked_ips, suspensions } — the rest is kept
export async function saveWatch(db, patch = {}) {
  const cur = await readWatch(db);
  const cut = Date.now() - 180 * D;
  const next = { ...cur, ...patch };
  next.suspensions = (next.suspensions || []).filter((s) => Date.parse(s.at || 0) >= cut).slice(-500);
  next.blocked_ips = (next.blocked_ips || []).filter((b) => Date.parse(b.until || 0) >= cut || b.unblocked).slice(-1000);
  next.settings = normSettings(next.settings || {});
  const [row] = await db.select('automations', `select=id&id=eq.${WATCH_ID}&limit=1`);
  const p = { enabled: false, free_tiers: [next], updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${WATCH_ID}`, p, { returning: 'minimal' });
  else await db.insert('automations', [{ id: WATCH_ID, wait_days: 0, ...p }], { returning: 'minimal' });
  return next;
}
export async function readSuspensions(db) { return (await readWatch(db)).suspensions; }
export async function writeSuspensions(db, list) { return (await saveWatch(db, { suspensions: list })).suspensions; }

// an admin decided (Open issues → keep / lift)
export async function reviewSuspension(db, userId, { lift = false, by = null } = {}) {
  const list = await readSuspensions(db);
  const at = new Date().toISOString();
  const next = list.map((s) => (String(s.user_id) === String(userId) ? { ...s, reviewed: true, reviewed_by: by, reviewed_at: at, ...(lift ? { lifted: true } : {}) } : s));
  if (lift) await db.update('users', `id=eq.${encodeURIComponent(userId)}`, { suspended: false }, { returning: 'minimal' });
  await writeSuspensions(db, next);
  return next.find((s) => String(s.user_id) === String(userId)) || null;
}

// Admin Manager → Security: unblock an IP (never blocked by itself again) / block one by hand
export async function unblockIp(db, ip, by = null) {
  const w = await readWatch(db);
  const at = new Date().toISOString();
  let hit = false;
  const list = w.blocked_ips.map((b) => (String(b.ip) === String(ip) && !b.unblocked ? ((hit = true), { ...b, unblocked: true, unblocked_by: by, unblocked_at: at }) : b));
  if (!hit) list.push({ ip: String(ip), reason: 'Allowed by an admin', at, until: at, unblocked: true, unblocked_by: by, unblocked_at: at, by });
  return (await saveWatch(db, { blocked_ips: list })).blocked_ips;
}
export async function blockIpByHand(db, ip, { reason = '', by = null, now = Date.now() } = {}) {
  const w = await readWatch(db);
  const list = w.blocked_ips.filter((b) => !(String(b.ip) === String(ip)));   // a new decision replaces the old one
  list.push({ ip: String(ip), reason: reason || 'Blocked by an admin', country: null, events: null, at: new Date(now).toISOString(), until: new Date(now + w.settings.blockDays * D).toISOString(), by: by || 'admin' });
  return (await saveWatch(db, { blocked_ips: list })).blocked_ips;
}
