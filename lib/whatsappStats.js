// WhatsApp contact numbers for the Analytics page's "WhatsApp contacts" card. Pure —
// no fetch — so vitest can check it (test/whatsappStats.test.js).
//
// Source: contact_link_clicks (every tap on a listing's WhatsApp / call / copy-number
// button, website AND app), already cleaned of the team's own contacts by the route.
// rows cover TWO windows: the current one (last `days`) and the one before it, for the
// "vs previous" change. props = those listings (type, city, owner).
import { openState } from './contactsReport.js';

// Local time per country, for "contacts per day" and the busiest hours.
export const COUNTRY_TZ = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador' };

const DAY = 86400000;
const isWhatsApp = (r) => (r.channel || 'whatsapp') === 'whatsapp';
// one person: their account, else their email, else their IP, else the tap itself
const buyerKey = (r) => r.buyer_user_id || (r.buyer_email && String(r.buyer_email).toLowerCase()) || r.buyer_ip || r.token || r.id;

function localParts(ms, tz) {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour) % 24 };
}

function counts(list, key) {
  const m = new Map();
  for (const x of list) {
    const k = key(x);
    if (k == null || k === '') continue;
    m.set(k, (m.get(k) || 0) + 1);
  }
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || String(a.name).localeCompare(String(b.name)));
}

function totals(rows, gap) {
  const wa = rows.filter(isWhatsApp);
  const opened = wa.filter((r) => openState(r, gap) === 'opened').length;
  const trackable = wa.filter((r) => openState(r, gap) !== 'untracked').length;
  return {
    whatsapp: wa.length,
    buyers: new Set(wa.map(buyerKey)).size,
    listings: new Set(wa.map((r) => r.property_id).filter(Boolean)).size,
    opened,
    trackable,
    openRate: trackable ? Math.round((opened / trackable) * 100) : null,
    calls: rows.filter((r) => r.channel === 'call').length,
    copies: rows.filter((r) => r.channel === 'copy').length,
  };
}

// → everything the card shows. now: ms epoch; days: window length; tz: IANA zone.
export function whatsappStats({ rows = [], props = [], days = 7, now = Date.now(), tz = 'America/Asuncion', gap = null } = {}) {
  const start = now - days * DAY;
  const prevStart = now - 2 * days * DAY;
  const t = (r) => Date.parse(r.created_at);
  const cur = rows.filter((r) => t(r) >= start && t(r) <= now);
  const prev = rows.filter((r) => t(r) >= prevStart && t(r) < start);
  const wa = cur.filter(isWhatsApp);
  const prop = new Map(props.map((p) => [p.id, p]));

  // WhatsApp taps per local day, every day of the window present (0 when none)
  const perDay = new Map();
  for (let i = days - 1; i >= 0; i--) perDay.set(localParts(now - i * DAY, tz).date, 0);
  const byHour = Array(24).fill(0);
  for (const r of wa) {
    const { date, hour } = localParts(t(r), tz);
    if (perDay.has(date)) perDay.set(date, perDay.get(date) + 1);
    byHour[hour] += 1;
  }

  const withProp = wa.map((r) => ({ r, p: prop.get(r.property_id) || null }));
  const known = withProp.filter((x) => x.p);
  const top = counts(wa.filter((r) => r.property_id), (r) => r.property_id).slice(0, 5).map(({ name: id, n }) => {
    const p = prop.get(id) || {};
    const mine = wa.filter((r) => r.property_id === id);
    return {
      property_id: id,
      ref: mine.find((r) => r.listing_ref)?.listing_ref || null,
      place: [p.neighborhood, p.city].filter(Boolean).join(', ') || p.address || null,
      type: p.property_type || null,
      mode: p.listing_type || null,
      whatsapp: n,
      opened: mine.filter((r) => openState(r, gap) === 'opened').length,
    };
  });

  return {
    days,
    totals: totals(cur, gap),
    previous: totals(prev, gap),
    daily: [...perDay.entries()].map(([date, n]) => ({ date, n })),
    byHour,
    byMode: counts(known, (x) => x.p.listing_type),
    byType: counts(known, (x) => x.p.property_type).slice(0, 6),
    byCity: counts(known, (x) => x.p.city).slice(0, 6),
    bySeller: counts(known, (x) => (x.p.created_by ? 'owner' : 'agency')),
    unknownListing: wa.length - known.length,   // listing since deleted / not found
    topListings: top,
  };
}

// "+25%" / "−10%" / "new" / null — change from the previous window.
export function change(now, before) {
  if (!before) return now ? 'new' : null;
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? '0%' : `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`;
}
