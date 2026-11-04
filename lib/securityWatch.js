// Security watch — auto-suspend (AI Operations Plan, step 5; Roland, 2 Nov: "any suspicious
// accounts, you should just suspend them … and notify them"). Hourly cron (/api/cron/security).
// The front door is the region block (website lib/geoBlock.js + the Cloudflare rule); this
// catches what gets through (a VPN, a new account) by behaviour:
//   region   a new account (last 30 days) whose WhatsApp number is from a blocked region, or
//            whose sign-up IP was seen in a blocked country
//   volume   a new account whose sign-up IP fired ≥ SECURITY_IP_EVENTS (default 500) events in
//            the last 24 h from abroad (a person reads a few dozen pages; a scraper hundreds)
// → users.suspended = true, an email to the person (reply if it's a mistake), and a record in
//   the `automations` row 'security_watch' (free_tiers[0].suspensions) that the Open issues list
//   shows as "keep or lift". Never the team (internal emails), never an account already
//   suspended or blocked, never one an admin lifted. SECURITY_AUTO_SUSPEND=0 → report only.
// Pure parts tested in test/securityWatch.test.js.
export const WATCH_ID = 'security_watch';
export const IP_EVENTS_DEFAULT = 500;
const D = 86400000;

// ISO codes of the region block (same list as the website's lib/geoBlock.js)
export const AFRICA = ['DZ', 'AO', 'BJ', 'BW', 'BF', 'BI', 'CV', 'CM', 'CF', 'TD', 'KM', 'CG', 'CD', 'CI', 'DJ', 'EG', 'GQ', 'ER', 'SZ', 'ET', 'GA', 'GM', 'GH', 'GN', 'GW', 'KE', 'LS', 'LR', 'LY', 'MG', 'MW', 'ML', 'MR', 'MU', 'MA', 'MZ', 'NA', 'NE', 'NG', 'RW', 'ST', 'SN', 'SC', 'SL', 'SO', 'ZA', 'SS', 'SD', 'TZ', 'TG', 'TN', 'UG', 'ZM', 'ZW', 'EH', 'RE', 'YT', 'SH'];
export function blockedCountries(setting) {
  const raw = setting === undefined || setting === null ? 'africa' : String(setting).trim();
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

// rows: [{ ip, country (ISO), countryName, events }] (24 h, per IP) · homeCountry 'PY'
// → Map(ip → { reason, ipCountry, events })
export function flaggedIps(rows = [], { blocked = new Set(), homeCountry = 'PY', minEvents = IP_EVENTS_DEFAULT } = {}) {
  const out = new Map();
  for (const r of rows) {
    const ip = String(r.ip || '').trim();
    if (!ip || ip === '?') continue;
    const cc = String(r.country || '').toUpperCase();
    if (cc && blocked.has(cc)) out.set(ip, { reason: `Visited from ${r.countryName || cc} (blocked region)`, ipCountry: r.countryName || cc, events: Number(r.events) || 0 });
    else if (Number(r.events) >= minEvents && cc && cc !== homeCountry.toUpperCase()) out.set(ip, { reason: `One IP fired ${Number(r.events).toLocaleString('en-US')} events in 24 h from ${r.countryName || cc} (scraper-like)`, ipCountry: r.countryName || cc, events: Number(r.events) || 0 });
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

// ── storage ──
export async function readSuspensions(db) {
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${WATCH_ID}&limit=1`).catch(() => []);
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return Array.isArray(s.suspensions) ? s.suspensions : [];
}
export async function writeSuspensions(db, list) {
  const cut = Date.now() - 180 * D;
  const keep = list.filter((s) => Date.parse(s.at || 0) >= cut).slice(-500);
  const [row] = await db.select('automations', `select=id&id=eq.${WATCH_ID}&limit=1`);
  const p = { enabled: false, free_tiers: [{ suspensions: keep }], updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${WATCH_ID}`, p, { returning: 'minimal' });
  else await db.insert('automations', [{ id: WATCH_ID, wait_days: 0, ...p }], { returning: 'minimal' });
  return keep;
}
// an admin decided (Open issues → keep / lift)
export async function reviewSuspension(db, userId, { lift = false, by = null } = {}) {
  const list = await readSuspensions(db);
  const at = new Date().toISOString();
  const next = list.map((s) => (String(s.user_id) === String(userId) ? { ...s, reviewed: true, reviewed_by: by, reviewed_at: at, ...(lift ? { lifted: true } : {}) } : s));
  if (lift) await db.update('users', `id=eq.${encodeURIComponent(userId)}`, { suspended: false }, { returning: 'minimal' });
  await writeSuspensions(db, next);
  return next.find((s) => String(s.user_id) === String(userId)) || null;
}
