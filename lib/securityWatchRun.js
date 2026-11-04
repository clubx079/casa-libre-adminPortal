// Security watch — one run for one country (the hourly cron /api/cron/security). Reads PostHog
// (events per IP, last 24 h, with the visitor's country) and that country's new accounts, then
// suspends + notifies per lib/securityWatch.js. dryRun → decides and reports, writes nothing.
// Server only.
import 'server-only';
import { dbFor } from './db';
import { selectAll } from './selectAll';
import { hogql, posthogConfigured } from './posthogHogql';
import { siteClause } from './analyticsSite';
import { HIDE_DELETED_USERS } from './userInsights';
import { isInternalEmail } from './internalTraffic';
import { sendManagerEmail } from './email';
import { blockedCountries, flaggedIps, toSuspend, readSuspensions, writeSuspensions, SUSPENDED_EMAIL, IP_EVENTS_DEFAULT } from './securityWatch';

const HOME = { py: 'PY', bo: 'BO', uy: 'UY', ve: 'VE', sv: 'SV' };
export const autoSuspendOn = () => process.env.SECURITY_AUTO_SUSPEND !== '0';

export async function runSecurityWatch(country, { dryRun = false, now = Date.now() } = {}) {
  const db = dbFor(country);
  const blocked = blockedCountries(process.env.GEO_BLOCK);
  const minEvents = Number(process.env.SECURITY_IP_EVENTS) || IP_EVENTS_DEFAULT;
  const out = { country, dryRun, autoSuspend: autoSuspendOn(), flaggedIps: 0, suspended: [], notified: 0 };
  let rows = [];
  if (posthogConfigured()) {
    // NOT filtered by the team's country here: a scraper could be anywhere; the team never
    // signs up with these IPs as a new account anyway (internal emails are skipped below)
    const r = await hogql(`SELECT coalesce(nullIf(properties.$ip, ''), '?') AS ip, any(properties.$geoip_country_code) AS cc, any(properties.$geoip_country_name) AS cn, count() AS events
      FROM events WHERE timestamp >= now() - INTERVAL 1 DAY ${siteClause(country)} GROUP BY ip HAVING events >= 20 ORDER BY events DESC LIMIT 200`, { fresh: 0, stale: 0, force: true }).catch((e) => { out.posthogError = String(e?.message || e).slice(0, 200); return []; });
    rows = (r || []).map(([ip, cc, cn, events]) => ({ ip, country: cc, countryName: cn, events: Number(events) || 0 }));
  } else out.posthogError = 'PostHog not configured';
  const ips = flaggedIps(rows.filter((x) => x.countryName !== 'Pakistan'), { blocked, homeCountry: HOME[country] || 'PY', minEvents });
  out.flaggedIps = ips.size;
  out.ipList = [...ips].slice(0, 10).map(([ip, v]) => ({ ip, ...v }));

  const since = new Date(now - 30 * 86400000).toISOString();
  const users = await selectAll(db, 'users', `select=id,full_name,email,phone,registration_ip,ip_address,suspended,blocked,created_at&created_at=gte.${encodeURIComponent(since)}&${HIDE_DELETED_USERS}&order=id.asc`).catch(() => []);
  const already = await readSuspensions(db).catch(() => []);
  const hits = toSuspend(users, { ips, blocked, already, isInternal: (e) => isInternalEmail(e) });
  out.suspended = hits.map((h) => ({ user_id: h.user.id, name: h.user.full_name || null, email: h.user.email || null, reason: h.reason, ip: h.ip || null }));
  if (dryRun || !autoSuspendOn() || !hits.length) return out;

  const records = [...already];
  for (const h of hits) {
    await db.update('users', `id=eq.${encodeURIComponent(h.user.id)}&suspended=not.is.true`, { suspended: true }, { returning: 'minimal' });
    let notified = false;
    if (h.user.email) {
      const text = SUSPENDED_EMAIL.text(h.user.full_name);
      const r = await sendManagerEmail({ country, to: h.user.email, subject: SUSPENDED_EMAIL.subject, text, html: `<p>${text.replace(/\n/g, '<br>')}</p>` }).catch(() => ({ ok: false }));
      notified = !!r?.ok;
      if (notified) out.notified++;
    }
    records.push({ user_id: h.user.id, name: h.user.full_name || null, email: h.user.email || null, phone: h.user.phone || null, reason: h.reason, ip: h.ip || null, ipCountry: h.ipCountry || null, at: new Date(now).toISOString(), notified, reviewed: false, by: 'security watch' });
  }
  await writeSuspensions(db, records);
  return out;
}
