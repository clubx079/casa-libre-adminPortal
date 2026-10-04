// Listing contacts (contact_link_clicks) for the UTM Links page's contacts tab.
// Pure — no fetch — so vitest can check it (test/contactsReport.test.js).
//
// Buyers who weren't signed in when they tapped WhatsApp: the website also sends a
// PostHog `contact_*_click` event carrying the SAME token as the contact row. If
// that visitor later signs in, PostHog links their earlier events to the account,
// so the token tells us who the buyer was.
//
// "Opened by seller": the listing page marks a contact opened when the seller lands
// with ?t=<token>. From 2026-09-14 the Paraguay messages linked /s/<short_code> with
// NO token, so those contacts can't show an open: they're "not trackable", not
// "not opened". Set `until` once the website + app fix (/s/<short_code>-<token>) is
// live, so contacts after that count again.
export const OPEN_TRACKING_GAP = {
  // until: the fixed website went live 2026-10-04 20:50Z, the app over the air 20:56Z
  // (phones that haven't restarted the app since may still send the old link).
  py: { from: '2026-09-14T00:00:00Z', until: '2026-10-04T20:56:00Z' },
};

const CONTACT_EVENTS = ['contact_whatsapp_click', 'contact_call_click', 'contact_copy_click'];
const SAFE_TOKEN = /^[A-Za-z0-9]{4,64}$/;
const isWhatsApp = (r) => (r.channel || 'whatsapp') === 'whatsapp';

// The PostHog click that goes with a contact row: the website fires `contact_*_click`
// on the same tap that creates the row. Clicks carry the row's token as
// `contact_token` (website change 2026-10); older clicks don't, so those are matched
// on the same listing + same button within MATCH_WINDOW_MS.
const MATCH_WINDOW_MS = 60 * 1000;
const EVENT_OF = { whatsapp: 'contact_whatsapp_click', call: 'contact_call_click', copy: 'contact_copy_click' };
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const hogTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ');

// → HogQL: every contact click around the contacts (signed in or not): who fired it
// (their CURRENT email, so later sign-ins count) and where from (IP, country, city).
// null when there are no contacts.
export function clickSql(rows = []) {
  const times = rows.filter((r) => ISO.test(String(r.created_at || ''))).map((r) => Date.parse(r.created_at));
  if (!times.length) return null;
  const from = hogTime(Math.min(...times) - 3600e3);
  const to = hogTime(Math.max(...times) + 3600e3);
  return `SELECT toString(timestamp), event, coalesce(properties.contact_token, ''), coalesce(properties.ref, ''),
      person.properties.email, person.properties.first_name, person.properties.last_name,
      properties.$ip, properties.$geoip_country_name, properties.$geoip_city_name
    FROM events
    WHERE event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(', ')})
      AND timestamp >= toDateTime('${from}') AND timestamp <= toDateTime('${to}')
    ORDER BY timestamp LIMIT 5000`;
}

// events: rows from clickSql. Each contact gets its click's buyer (when we didn't know
// them: they signed in later) and IP / location (when the website didn't save one).
export function applyClicks(rows = [], events = []) {
  const ev = events.map(([at, event, token, ref, email, first, last, ip, country, city]) => ({
    at: Date.parse(String(at).replace(' ', 'T').replace(/(\d)$/, '$1Z')), event, token, ref,
    email: email || null, name: [first, last].filter(Boolean).join(' ') || null,
    ip: ip || null, country: country || null, city: city || null,
  })).filter((e) => Number.isFinite(e.at));
  return rows.map((r) => {
    let m = r.token && SAFE_TOKEN.test(String(r.token)) ? ev.find((e) => e.token === r.token) : null;
    if (!m) {
      const t = Date.parse(r.created_at);
      const want = EVENT_OF[r.channel || 'whatsapp'];
      const near = ev
        .filter((e) => e.event === want && e.ref && e.ref === r.listing_ref && Math.abs(e.at - t) <= MATCH_WINDOW_MS)
        .sort((a, b) => Math.abs(a.at - t) - Math.abs(b.at - t));
      m = near[0] || null;
    }
    const out = {
      ...r,
      buyer_ip: r.buyer_ip || m?.ip || null,
      buyer_country: r.buyer_country || m?.country || null,
      buyer_city: r.buyer_city || m?.city || null,
    };
    if (!r.buyer_email && m?.email) Object.assign(out, { buyer_email: m.email, buyer_name: r.buyer_name || m.name, buyer_signed_up_later: true });
    return out;
  });
}

// 'opened' | 'not_opened' | 'untracked' (WhatsApp) — 'n/a' for calls / copied numbers.
export function openState(r, gap = null) {
  if (!isWhatsApp(r)) return 'n/a';
  if (r.opened_at || r.status === 'opened') return 'opened';
  const at = r.created_at || '';
  if (gap && at >= gap.from && (!gap.until || at < gap.until)) return 'untracked';
  return 'not_opened';
}

export function contactStats(rows = [], gap = null) {
  const wa = rows.filter(isWhatsApp);
  const opened = wa.filter((r) => openState(r, gap) === 'opened').length;
  const untracked = wa.filter((r) => openState(r, gap) === 'untracked').length;
  const trackable = wa.length - untracked;
  return {
    whatsapp: wa.length,
    opened,
    trackable,
    rate: trackable ? Math.round((opened / trackable) * 100) : 0,
    untracked,
    calls: rows.filter((r) => r.channel === 'call').length,
    copies: rows.filter((r) => r.channel === 'copy').length,
  };
}

// The listing reference the website shows (buyer portal lib/ui.js clRef): CL- + the
// first 6 letters/digits of the listing id, upper-cased.
export function clRef(id) {
  if (!id) return null;
  const s = String(id).replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
  return s ? `CL-${s}` : null;
}

// Contact rows only saved the seller's name/phone the button had (the mobile app
// sends neither, agency listings send no name). Fill them from the listing, and add
// the account email when a Casa Libre user published it. Agency listings (scraped
// from other sites) have no account, so no email exists for them.
// props: [{ id, contact_name, contact_phone, created_by }] · users: [{ id, email, full_name }]
export function fillSellers(rows = [], props = [], users = []) {
  const prop = new Map(props.map((p) => [p.id, p]));
  const user = new Map(users.map((u) => [u.id, u]));
  const digits = (v) => (v ? String(v).replace(/\D/g, '') || null : null);
  return rows.map((r) => {
    const p = prop.get(r.property_id);
    const owner = p?.created_by ? user.get(p.created_by) : null;
    const ownerEmail = owner?.email && !/@deleted\.invalid$/i.test(owner.email) ? owner.email : null;
    return {
      ...r,
      seller_name: r.seller_name || p?.contact_name || owner?.full_name || null,
      seller_phone: r.seller_phone || digits(p?.contact_phone),
      seller_email: ownerEmail,
      seller_kind: p ? (p.created_by ? 'user' : 'agency') : null,
      listing_ref: r.listing_ref || clRef(r.property_id),
    };
  });
}
