// Security watch — one run for one country (the hourly cron /api/cron/security, and the Admin
// Manager → Security card's "Check now"). Reads PostHog (website events per IP, last 24 h), flags
// the suspicious IPs (lib/securityWatch.js), puts them on the blocked list the website turns
// away, and suspends new accounts that signed up from one. dryRun → decides and reports,
// writes nothing. Server only.
import 'server-only';
import { dbFor } from './db';
import { selectAll } from './selectAll';
import { hogql, posthogConfigured } from './posthogHogql';
import { siteClause } from './analyticsSite';
import { HIDE_DELETED_USERS } from './userInsights';
import { isInternalEmail } from './internalTraffic';
import { sendManagerEmail } from './email';
import { blockedCountries, flaggedIps, toSuspend, readWatch, saveWatch, ipsToBlock, allowedIps, activeBlocks, SUSPENDED_EMAIL } from './securityWatch';

const HOME = { py: 'PY', bo: 'BO', uy: 'UY', ve: 'VE', sv: 'SV' };
export const homeCountryOf = (country) => HOME[country] || 'PY';
export const autoSuspendOn = () => process.env.SECURITY_AUTO_SUSPEND !== '0';

// the busiest IPs of the last 24 h (website, browser events only: the server's own events and the
// app are left out, so our own server is never judged)
export async function busiestIps(country, { limit = 200 } = {}) {
  if (!posthogConfigured()) return { rows: [], error: 'PostHog not configured' };
  try {
    const r = await hogql(`SELECT coalesce(nullIf(properties.$ip, ''), '?') AS ip, any(properties.$geoip_country_code) AS cc, any(properties.$geoip_country_name) AS cn,
        count() AS events, uniqExact(distinct_id) AS visitors, countIf(event = 'property_viewed') AS views
      FROM events WHERE timestamp >= now() - INTERVAL 1 DAY AND properties.$lib = 'web' ${siteClause(country)}
      GROUP BY ip HAVING events >= 20 ORDER BY events DESC LIMIT ${Number(limit)}`, { fresh: 0, stale: 0, force: true });
    const flat = (r || []).map((x) => (Array.isArray(x) ? x : Object.values(x)));
    return { rows: flat.map(([ip, cc, cn, events, visitors, views]) => ({ ip, country: cc, countryName: cn, events: Number(events) || 0, visitors: Number(visitors) || 0, views: Number(views) || 0 })) };
  } catch (e) {
    return { rows: [], error: String(e?.message || e).slice(0, 200) };
  }
}

export async function runSecurityWatch(country, { dryRun = false, now = Date.now() } = {}) {
  const db = dbFor(country);
  const blocked = blockedCountries(process.env.GEO_BLOCK);
  const watch = await readWatch(db);
  const S = watch.settings;
  const out = { country, dryRun, autoSuspend: autoSuspendOn(), settings: S, flaggedIps: 0, newlyBlocked: [], suspended: [], notified: 0 };
  const { rows, error } = await busiestIps(country);
  if (error) out.posthogError = error;
  // the team (Pakistan) is never judged
  const ips = flaggedIps(rows.filter((x) => x.countryName !== 'Pakistan'), { blocked, homeCountry: homeCountryOf(country), minEvents: S.abroadEvents, homeMinEvents: S.homeEvents, allowed: allowedIps(watch.blocked_ips) });
  out.flaggedIps = ips.size;
  out.ipList = [...ips].slice(0, 10).map(([ip, v]) => ({ ip, ...v }));
  const add = ipsToBlock(ips, watch.blocked_ips, { now, days: S.blockDays });
  out.newlyBlocked = add.map((b) => ({ ip: b.ip, reason: b.reason, until: b.until }));
  out.activeBlocks = activeBlocks(watch.blocked_ips, now).length + add.length;

  const since = new Date(now - 30 * 86400000).toISOString();
  const users = await selectAll(db, 'users', `select=id,full_name,email,phone,registration_ip,ip_address,suspended,blocked,created_at&created_at=gte.${encodeURIComponent(since)}&${HIDE_DELETED_USERS}&order=id.asc`).catch(() => []);
  const hits = toSuspend(users, { ips, blocked, already: watch.suspensions, isInternal: (e) => isInternalEmail(e) });
  out.suspended = hits.map((h) => ({ user_id: h.user.id, name: h.user.full_name || null, email: h.user.email || null, reason: h.reason, ip: h.ip || null }));
  if (dryRun || !autoSuspendOn() || (!hits.length && !add.length)) return out;

  const records = [...watch.suspensions];
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
  await saveWatch(db, { suspensions: records, blocked_ips: [...watch.blocked_ips, ...add] });
  return out;
}
