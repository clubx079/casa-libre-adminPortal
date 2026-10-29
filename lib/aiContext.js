// Loads the AI reply's fact sheet (lib/aiFacts.js) for one WhatsApp number — READ-ONLY selects
// on that person's own rows in ONE country DB (the site their number came from). Nothing here
// writes, and the AI gets only the finished sheet, never a query. Server only.
import 'server-only';
import { dbFor } from './db';
import { countryInfo } from './automationAdmin';
import { paidConfig, priceCents, usd, PAID_LISTINGS_ID } from './paidListingsAdmin';
import { SITE_TAG } from './inboxRules';
import { buildFactSheet } from './aiFacts';

const enc = encodeURIComponent;
const USER_COLS = 'id,email,full_name,phone,phone_verified_at,created_at,auth_provider';

// The site to answer for: the one the number came from (the admin's country first when it is one of them).
export function siteFor(conv, active) {
  const sites = (conv?.tags || []).filter((t) => String(t).startsWith(SITE_TAG)).map((t) => String(t).slice(SITE_TAG.length));
  return sites.includes(active) ? active : sites[0] || active;
}

export async function loadFactSheet(phone, conv, active) {
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
  const [listings, drafts, [paidRow], recent] = await Promise.all([
    user ? safe(db.select('properties', `select=id,slug,status,admin_status,is_complete,property_type,listing_type,neighborhood,city,price,currency,created_at,raw_data&created_by=eq.${enc(user.id)}&origin=eq.user&order=created_at.desc&limit=20`)) : [],
    user ? safe(db.select('listing_drafts', `select=id,data,updated_at&user_id=eq.${enc(user.id)}&order=updated_at.desc&limit=5`)) : [],
    safe(db.select('automations', `select=*&id=eq.${PAID_LISTINGS_ID}&limit=1`)),
    user?.email ? safe(db.select('email_log', `select=created_at,channel,subject,automation_id&to_email=eq.${enc(user.email)}&status=in.(sent,delivered,read)&order=created_at.desc&limit=8`)) : [],
  ]);
  const cfg = paidConfig(paidRow || null);
  return buildFactSheet({
    cc, countryName: info.countryName, site: info.site, user: user || null, listings, drafts, recent,
    paid: { enabled: cfg.enabled, freePerMonth: cfg.freePerMonth, price: usd(priceCents(cfg)) },
    codeRequested: (conv?.tags || []).includes(`${SITE_TAG}${cc}`),
  });
}
