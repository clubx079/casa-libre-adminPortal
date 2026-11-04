// Loads the AI reply's fact sheet (lib/aiFacts.js) for one WhatsApp number — READ-ONLY selects
// on that person's own rows in ONE country DB (the site their number came from). Nothing here
// writes, and the AI gets only the finished sheet, never a query. Server only.
import 'server-only';
import { dbFor } from './db';
import { countryInfo } from './automationAdmin';
import { paidConfig, priceCents, usd, PAID_LISTINGS_ID } from './paidListingsAdmin';
import { SITE_TAG } from './inboxRules';
import { buildFactSheet } from './aiFacts';
import { aiLink, aiRef } from './aiLinks';
import { historyLines } from './aiHistory';
import { hogql, posthogConfigured } from './posthogHogql';
import { UKEY, GEO_BASE } from './posthogSql';
import { siteClause } from './analyticsSite';

// How busy this country's site is + views of this person's listings (PostHog), and buyer
// contacts on them (contact_link_clicks). Best effort: a failed source leaves it out.
async function loadActivity(db, cc, listings) {
  const out = { site: null, byListing: new Map(), areaDemand: [] };
  const ids = listings.map((p) => p.id).filter((x) => /^[0-9a-f-]{36}$/i.test(String(x)));
  // the demand around their listings: views of listings in the same city (and same type) on this site
  const cities = [...new Set(listings.map((p) => String(p.city || '').trim().toLowerCase()).filter((c) => c && !/['\\]/.test(c)))].slice(0, 3);
  const tasks = [];
  if (posthogConfigured()) {
    const where = `${GEO_BASE}${siteClause(cc)}`;
    tasks.push(hogql(`SELECT uniqExactIf(${UKEY}, timestamp >= now() - INTERVAL 7 DAY), uniqExactIf(${UKEY}, timestamp < now() - INTERVAL 7 DAY AND timestamp >= now() - INTERVAL 14 DAY),
        uniqExactIf(${UKEY}, timestamp >= now() - INTERVAL 30 DAY), countIf(event = 'property_viewed' AND timestamp >= now() - INTERVAL 7 DAY), countIf(event = 'property_viewed')
      FROM events WHERE timestamp >= now() - INTERVAL 30 DAY AND ${where}`).then((rows) => {
      const [v7, vPrev7, v30, pv7, pv30] = (rows?.[0] || []).map((n) => Number(n) || 0);
      out.site = {
        visitors_last_7_days: v7, visitors_previous_7_days: vPrev7, visitors_growth_pct: vPrev7 ? Math.round(((v7 - vPrev7) / vPrev7) * 100) : null,
        visitors_last_30_days: v30, property_views_last_7_days: pv7, property_views_last_30_days: pv30,
      };
    }).catch(() => {}));
    if (cities.length) {
      tasks.push(hogql(`SELECT lower(toString(properties.city)) AS c, lower(toString(properties.type)) AS t, count() AS v30, countIf(timestamp >= now() - INTERVAL 7 DAY) AS v7, uniqExact(${UKEY}) AS p30
        FROM events WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL 30 DAY AND ${where} AND lower(toString(properties.city)) IN (${cities.map((c) => `'${c}'`).join(',')}) GROUP BY c, t`).then((rows) => {
        for (const city of cities) {
          const mine = (rows || []).filter((r) => r[0] === city);
          if (!mine.length) continue;
          const sum = (i) => mine.reduce((t, r) => t + (Number(r[i]) || 0), 0);
          const types = [...new Set(listings.filter((p) => String(p.city || '').trim().toLowerCase() === city).map((p) => String(p.property_type || '').toLowerCase()))];
          const same = mine.filter((r) => types.includes(r[1]));
          out.areaDemand.push({
            city: listings.find((p) => String(p.city || '').trim().toLowerCase() === city)?.city || city,
            listing_views_last_30_days: sum(2), listing_views_last_7_days: sum(3), people_viewing_last_30_days: sum(4),
            ...(same.length ? { same_type: types.join(' / '), same_type_views_last_30_days: same.reduce((t, r) => t + (Number(r[2]) || 0), 0) } : {}),
          });
        }
      }).catch(() => {}));
    }
    if (cities.length && ids.length) {
      tasks.push(hogql(`SELECT toString(properties.property_id) AS pid, lower(toString(properties.city)) AS c, count() AS v
        FROM events WHERE event = 'property_viewed' AND timestamp >= now() - INTERVAL 30 DAY AND ${where} AND lower(toString(properties.city)) IN (${cities.map((c) => `'${c}'`).join(',')}) GROUP BY pid, c`).then((rows) => {
        for (const p of listings) {
          const city = String(p.city || '').trim().toLowerCase();
          const all = (rows || []).filter((r) => r[1] === city).map((r) => ({ id: String(r[0]), v: Number(r[2]) || 0 })).sort((a, b) => b.v - a.v);
          const i = all.findIndex((x) => x.id === String(p.id));
          if (i < 0 || all.length < 5) continue;
          const top = Math.max(1, Math.ceil(((i + 1) / all.length) * 100));
          if (top <= 50) out.byListing.set(String(p.id), { ...(out.byListing.get(String(p.id)) || {}), most_viewed_rank_in_city: `#${i + 1} of ${all.length} listings in ${p.city} this month (top ${top}%)` });
        }
      }).catch(() => {}));
    }
    if (ids.length) {
      tasks.push(hogql(`SELECT toString(properties.property_id) AS pid, count() AS views, countIf(timestamp >= now() - INTERVAL 7 DAY) AS views7
        FROM events WHERE event = 'property_viewed' AND toString(properties.property_id) IN (${ids.map((x) => `'${x}'`).join(',')}) AND timestamp >= now() - INTERVAL 180 DAY GROUP BY pid`).then((rows) => {
        for (const [pid, n, n7] of rows || []) out.byListing.set(String(pid), { ...(out.byListing.get(String(pid)) || {}), views_total: Number(n) || 0, views_last_7_days: Number(n7) || 0 });
      }).catch(() => {}));
    }
  }
  if (ids.length) {
    tasks.push(db.select('contact_link_clicks', `select=property_id&property_id=in.(${ids.join(',')})&limit=2000`).then((rows) => {
      const by = new Map();
      for (const r of rows || []) by.set(String(r.property_id), (by.get(String(r.property_id)) || 0) + 1);
      for (const [pid, n] of by) out.byListing.set(pid, { ...(out.byListing.get(pid) || {}), buyer_contacts: n });
    }).catch(() => {}));
  }
  await Promise.all(tasks);
  return out;
}

const enc = encodeURIComponent;
const USER_COLS = 'id,email,full_name,phone,phone_verified_at,created_at,auth_provider';

// The site to answer for: the one the number came from (the admin's country first when it is one of them).
export function siteFor(conv, active) {
  const sites = (conv?.tags || []).filter((t) => String(t).startsWith(SITE_TAG)).map((t) => String(t).slice(SITE_TAG.length));
  return sites.includes(active) ? active : sites[0] || active;
}

// opts.answer = the reply these links belong to (lib/aiLinks.js): every link is tracked to the person + reply
export async function loadFactSheet(phone, conv, active, { answer = '' } = {}) {
  const cc = siteFor(conv, active);
  const info = countryInfo(cc);
  const db = dbFor(cc);
  const tail = String(phone || '').replace(/\D/g, '').slice(-8);
  const safe = (p) => p.catch(() => []);
  let [user] = tail.length === 8 ? await safe(db.select('users', `select=${USER_COLS}&phone=ilike.${enc(`%${tail}%`)}&order=phone_verified_at.desc.nullslast&limit=1`)) : [];
  if (!user && tail.length === 8) {
    const [p] = await safe(db.select('properties', `select=created_by&origin=eq.user&contact_phone=ilike.${enc(`%${tail}%`)}&created_by=not.is.null&order=created_at.desc&limit=1`));
    if (p?.created_by) [user] = await safe(db.select('users', `select=${USER_COLS}&id=eq.${enc(p.created_by)}&limit=1`));
  }
  const [listings, drafts, [paidRow], recent, payments] = await Promise.all([
    user ? safe(db.select('properties', `select=id,slug,status,admin_status,is_complete,property_type,listing_type,neighborhood,city,price,currency,created_at,raw_data&created_by=eq.${enc(user.id)}&origin=eq.user&order=created_at.desc&limit=20`)) : [],
    user ? safe(db.select('listing_drafts', `select=id,data,updated_at&user_id=eq.${enc(user.id)}&order=updated_at.desc&limit=5`)) : [],
    safe(db.select('automations', `select=*&id=eq.${PAID_LISTINGS_ID}&limit=1`)),
    user?.email ? safe(db.select('email_log', `select=created_at,channel,subject,automation_id&to_email=eq.${enc(user.email)}&status=in.(sent,delivered,read)&order=created_at.desc&limit=8`)) : [],
    user ? safe(db.select('payments', `select=kind,plan,amount_usd,status,failure_reason,property_id,created_at&user_id=eq.${enc(user.id)}&order=created_at.desc&limit=8`)) : [],
  ]);
  // everything we did with them before (their "Messages & activity"): by email or by number
  const mail = String(user?.email || '').toLowerCase();
  const who = [mail && `to_email.eq.${mail}`, tail.length === 8 && `to_phone.like.%${tail}`].filter(Boolean).map(enc).join(',');
  const [logRows, feedback] = await Promise.all([
    who ? safe(db.select('email_log', `select=automation_id,template_key,channel,to_email,to_phone,subject,status,error,created_at&or=(${who})&order=created_at.desc&limit=150`)) : [],
    (user?.id || mail) ? safe(db.select('feedback', `select=rating,message,created_at&or=(${[user?.id && `user_id.eq.${user.id}`, mail && `email.eq.${mail}`].filter(Boolean).map(enc).join(',')})&order=created_at.desc&limit=20`)) : [],
  ]);
  const history = historyLines({ rows: logRows.filter((r) => (mail && String(r.to_email || '').toLowerCase() === mail) || String(r.to_phone || '').replace(/\D/g, '').endsWith(tail)), feedback });
  const cfg = paidConfig(paidRow || null);
  const activity = await loadActivity(db, cc, listings);
  const ref = aiRef(phone);
  return buildFactSheet({ activity, link: (path) => aiLink(info.site, path, { ref, answer }),
    cc, countryName: info.countryName, site: info.site, user: user || null, listings, drafts, recent, payments, history,
    paid: { enabled: cfg.enabled, freePerMonth: cfg.freePerMonth, price: usd(priceCents(cfg)) },
    codeRequested: (conv?.tags || []).includes(`${SITE_TAG}${cc}`),
  });
}
