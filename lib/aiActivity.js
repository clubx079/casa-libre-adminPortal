// What this person actually DID on the site / in the app lately, for the Inbox assistant's fact
// sheet (lib/aiFacts.js → recent_activity) — so "no me deja subir más fotos, me quieren cobrar"
// is answered from what happened ("your 6 photos were saved; the payment screen opened because
// a paid option was selected") instead of generically.
//   · from OUR RECORDS (the country DB, always there): the saves in each listing's edit log
//     (properties.raw_data.edits: when, photos added / removed, which fields)
//   · from the site's click tracking (PostHog, best effort): their last events of ~48 h, reduced
//     to plain lines — opened the edit form for listing X, tapped the paid option "Insignia
//     Verificada", pressed "Guardar cambios", the payment screen opened, errors — app or web, OS.
// Noise is dropped (page leaves, screens, unlabelled taps, searches, promos): only an allow-list
// of events becomes a line, in words — the raw event names never reach the model or the customer.
// Hard caps: MAX_LINES lines of MAX_LINE characters (about 1.5 k tokens at most).
// Pure — test/aiActivity.test.js. The queries: lib/aiContext.js.

export const ACTIVITY_HOURS = 48;
export const EDIT_LOG_DAYS = 7;
export const MAX_LINES = 40;
export const MAX_LINE = 160;
export const EVENT_LIMIT = 400;

const MIN = 60_000;
const cut = (s, n) => { const v = String(s ?? '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
// PostHog's "2026-11-11 13:12:36.123000" / ISO → ms
export const when = (ts) => { const s = String(ts || ''); const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${s.replace(' ', 'T')}Z`); return Number.isFinite(t) ? t : 0; };
export function ago(at, now) {
  const d = Math.max(0, now - at);
  if (d < MIN) return 'just now';
  if (d < 60 * MIN) return `${Math.round(d / MIN)} min ago`;
  if (d < 48 * 60 * MIN) return `${Math.round(d / (60 * MIN))} h ago`;
  return `${Math.round(d / (24 * 60 * MIN))} days ago`;
}

// ── the PostHog query: this one person, the last 48 h, noise left out at the source ──────────
const NOISE = ['$pageleave', '$screen', '$set', '$identify', '$groupidentify', '$feature_flag_called', '$web_vitals', 'Application Backgrounded', 'Application Became Active', 'Application Installed', 'Application Updated', 'app_promo_shown', 'app_promo_closed', 'app_badge_clicked', 'search_applied', 'map_pin_clicked', 'property_saved', 'property_unsaved', 'description_translated', 'link_click'];
export const ACTIVITY_COLS = ['at', 'event', 'lib', 'os', 'path', 'url', 'label', 'click', 'property_id', 'outcome', 'new_photos', 'kind', 'reason', 'error', 'app_version', 'photos'];
const uuid = (x) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(x || ''));
const safeEmail = (e) => { const v = String(e || '').trim().toLowerCase(); return /^[^\s'"\\@]+@[^\s'"\\@]+\.[^\s'"\\@]+$/.test(v) ? v : ''; };

// → the HogQL text, or null when there is nobody to look for. Matched by the account's id (the
// site and the app identify people by it) or its email.
export function activityQuery({ userId, email, hours = ACTIVITY_HOURS, limit = EVENT_LIMIT } = {}) {
  const who = [];
  if (uuid(userId)) who.push(`distinct_id = '${userId}'`, `toString(properties.user_id) = '${userId}'`);
  if (safeEmail(email)) who.push(`lower(person.properties.email) = '${safeEmail(email)}'`);
  if (!who.length) return null;
  return `SELECT timestamp, event, properties.$lib, properties.$os, properties.$pathname, properties.$current_url, properties.$el_text, properties.$event_type,
      toString(properties.property_id), properties.outcome, properties.new_photos, properties.kind, properties.reason, properties.$exception_message, coalesce(properties.$app_version, properties.app_version), properties.photos
    FROM events
    WHERE (${who.join(' OR ')}) AND timestamp >= now() - INTERVAL ${Math.round(hours)} HOUR
      AND event NOT IN (${NOISE.map((e) => `'${e}'`).join(', ')})
      AND NOT (event IN ('$autocapture', '$rageclick') AND (coalesce(properties.$el_text, '') = '' OR coalesce(properties.$event_type, 'click') != 'click'))
    ORDER BY timestamp DESC LIMIT ${Math.round(limit)}`;
}
export const rowsToEvents = (rows = []) => rows.map((r) => Object.fromEntries(ACTIVITY_COLS.map((c, i) => [c, r[i] ?? null])));

// ── one event → words (null = noise) ─────────────────────────────────────────────────────────
const OWNER_PAGE = /^\/(publicar|cuenta|vender)(\/|$)/;
const NAV_LABEL = /^(siguiente|anterior|atr[aá]s|volver|cerrar|cancelar|ok|listo|continuar|next|back|close|cancel|men[uú]|[‹›<>×x+\-–]|\d+)$/i;
const PAID_LABEL = /US\$\s*\d|Gs\.?\s*\d|₲\s*\d/;

function tapLine(e) {
  const full = cut(e.label, 300);
  const label = cut(full, PAID_LABEL.test(full) ? 95 : 60);
  if (!label || label.length < 2 || NAV_LABEL.test(label)) return null;
  if (!OWNER_PAGE.test(String(e.path || ''))) return null;   // taps while browsing listings say nothing about their problem
  const again = e.event === '$rageclick' ? ' several times in a row' : '';
  if (/fotos? seleccionadas?|photos? selected/i.test(label)) return `chose photos to upload ("${label}")`;
  if (PAID_LABEL.test(full)) return `tapped a PAID optional extra${again}: "${label}"`;
  if (/guardar cambios|save changes/i.test(label)) return `pressed "${label}" (save)${again}`;
  return `tapped "${label}"${again}`;
}

function pageLine(e, name) {
  const url = String(e.url || '');
  const path = String(e.path || '');
  const q = (k) => { const m = new RegExp(`[?&]${k}=([^&#]+)`).exec(url); return m ? decodeURIComponent(m[1]) : ''; };
  if (q('pay_listing')) return `opened the payment page for ${name(q('pay_listing'))}`;
  if (q('edit')) return null;   // "opened the edit form" follows as its own event
  if (/tab=rechazadas/.test(url)) return 'opened the "Rechazadas" (rejected photos) tab of My listings';
  if (/tab=borradores/.test(url)) return 'opened their drafts in My listings';
  if (path === '/cuenta/publicaciones') return 'opened My listings';
  if (path === '/publicar') return 'opened the publish page';
  return null;
}

const OUTCOME = { saved: 'SAVED', checking: 'SAVED — the new photos are in the automatic photo check, then it is live again', duplicate: 'saved, but HELD as a possible duplicate of another of their listings' };

// name(id) → how the fact sheet calls that listing ("house · Loma Barrero")
export function eventLine(e, name = () => 'a listing') {
  const pid = e.property_id && e.property_id !== 'null' ? e.property_id : '';
  const L = () => (pid ? name(pid) : 'a listing');
  switch (e.event) {
    case 'app_opened': case 'Application Opened': return 'opened the app';
    case 'edit_tapped': return `tapped "Editar" on ${L()} in the app`;
    case 'publish_tapped': return 'tapped "Publicar" in the app';
    case 'listing_edit_opened': return `the edit form opened for ${L()}`;
    case 'listing_edited': return `their edit of ${L()} was ${OUTCOME[e.outcome] || 'saved'}${Number(e.new_photos) > 0 ? ` (${Number(e.new_photos)} new ${Number(e.new_photos) === 1 ? 'photo' : 'photos'})` : ''}`;
    case 'listing_created': return `published a new listing${pid ? `: ${L()}` : ''}${Number(e.photos) > 0 ? ` (${Number(e.photos)} photos)` : ''}`;
    case 'sell_wizard_opened': return 'opened the publish form';
    case 'sell_draft_resumed': return 'continued an unfinished draft in the publish form';
    case 'sell_pin_needed': return 'the publish form asked them to place the pin on the map (the address was not found exactly)';
    case 'sell_pin_placed': return 'placed the pin on the map';
    case 'sell_otp_sent': case 'sign_up_code_sent': case 'login_code_sent': return 'asked for a sign-in code';
    case 'sell_otp_verified': return 'entered the sign-in code correctly';
    case 'sell_wa_check_sent': return 'was sent a WhatsApp code to confirm their number';
    case 'sell_wa_check_verified': return 'confirmed their WhatsApp number with the code';
    case 'sell_google_abandoned': return 'started "Continue with Google" in the publish form and did not finish';
    case 'sell_google_resumed': return 'came back from Google sign-in to the publish form';
    case 'oauth_login_clicked': return 'tapped "Continue with Google"';
    case 'user_logged_in': return 'signed in';
    case 'user_signed_up': case 'account_created': return 'created their account';
    case 'payment_screen_opened': return `the payment screen opened for ${L()}${e.kind ? ` (${cut(e.kind, 30)})` : ''} — nothing is charged unless they finish it`;
    case 'payment_started': return `pressed Pay for ${L()}${e.kind ? ` (${cut(e.kind, 30)})` : ''}`;
    case 'payment_succeeded': return `their payment went through for ${L()}${e.kind ? ` (${cut(e.kind, 30)})` : ''}`;
    case 'gift_claimed': case 'listing_gift_claimed': return `claimed their free gift${pid ? ` for ${L()}` : ''}`;
    case 'gift_claim_failed': case 'listing_gift_failed': return `tried to claim a gift and it did not work${e.reason ? ` (${cut(e.reason, 40)})` : ''}`;
    case 'property_viewed': return pid && name(pid, true) ? `looked at their own listing ${name(pid)}` : null;
    case 'contact_whatsapp_click': case 'contact_call_click': case 'contact_copy_click': case 'contact_seller_clicked': return 'contacted the seller of a property (as a buyer)';
    case '$exception': return `an ERROR appeared on the page${e.error ? `: "${cut(e.error, 70)}"` : ''}`;
    case '$pageview': return pageLine(e, name);
    case '$autocapture': case '$rageclick': return tapLine(e);
    default: return null;   // anything not listed is noise
  }
}

// app or website, and the phone's system
export function whereOf(e) {
  const app = /react-native/i.test(String(e.lib || '')) || e.event === 'app_opened';
  const os = e.os ? String(e.os) : '';
  return [app ? 'app' : 'website', os].filter(Boolean).join(', ');
}

const FIELD = { price_usd: 'price', price: 'price', currency: 'currency', description: 'description', neighborhood: 'neighbourhood', city: 'city', address: 'address', latitude: 'map pin', longitude: 'map pin', covered_area: 'area', land_area: 'area', bedrooms: 'bedrooms', bathrooms: 'bathrooms', contact_phone: 'contact number', contact_name: 'contact name', property_type: 'property type', listing_type: 'sale / rent', seller_type: 'seller type' };
const fieldsInWords = (fields = []) => [...new Set(fields.map((f) => FIELD[f] || String(f).replace(/_/g, ' ')))].slice(0, 6).join(', ');
const n = (x, one, many) => `${x} ${x === 1 ? one : many}`;

// One saved edit from the listing's own log → words. This is what really got saved.
export function editLine(edit, listingName) {
  const added = Number(edit.new_photos) || 0; const removed = Number(edit.removed_photos) || 0;
  const what = [added ? `${n(added, 'photo', 'photos')} ADDED` : '', removed ? `${n(removed, 'photo', 'photos')} removed` : '', (edit.fields || []).length ? `changed: ${fieldsInWords(edit.fields)}` : ''].filter(Boolean);
  if (edit.by === 'team') return `the Casa-Libre team edited ${listingName}${what.length ? ` (${what.join('; ')})` : ''}${edit.note ? ` — ${cut(edit.note, 60)}` : ''}`;
  return `their edit of ${listingName} was SAVED in our records: ${what.length ? what.join('; ') : 'no changes to photos or details'}`;
}

// Per listing, for its row in the fact sheet: the last saves, newest first.
export function listingEdits(p, now, { max = 3, days = 30 } = {}) {
  const edits = Array.isArray(p?.raw_data?.edits) ? p.raw_data.edits : [];
  return edits.filter((e) => when(e.at) && when(e.at) <= now + MIN && now - when(e.at) < days * 86400000).sort((a, b) => when(b.at) - when(a.at)).slice(0, max).map((e) => {
    const added = Number(e.new_photos) || 0; const removed = Number(e.removed_photos) || 0;
    const what = [added ? `${n(added, 'photo', 'photos')} added` : '', removed ? `${n(removed, 'photo', 'photos')} removed` : '', (e.fields || []).length ? `changed ${fieldsInWords(e.fields)}` : ''].filter(Boolean).join(', ') || 'saved with no changes';
    return `${ago(when(e.at), now)}${e.by === 'team' ? ' (by our team)' : ''}: ${what}`;
  });
}

// → { window, lines: [...], click_tracking } for the fact sheet, or null when there is nothing.
//   events: rowsToEvents(PostHog rows) | null (not asked / failed / timed out)
//   listings: the person's listing rows (id, raw_data.edits …);  nameOf(listing) → its name
export function buildRecentActivity({ events = null, listings = [], nameOf = () => 'a listing', now = Date.now(), maxLines = MAX_LINES, tracking = 'ok' } = {}) {
  const byId = new Map(listings.map((p) => [String(p.id), p]));
  const name = (id, ownOnly = false) => { const p = byId.get(String(id)); return p ? nameOf(p) : ownOnly ? '' : 'a listing'; };
  const items = [];   // { at, where, what }
  for (const p of listings) {
    for (const ed of Array.isArray(p?.raw_data?.edits) ? p.raw_data.edits : []) {
      const at = when(ed.at);
      if (at && at <= now + MIN && now - at < EDIT_LOG_DAYS * 86400000) items.push({ at, where: 'our records', what: editLine(ed, nameOf(p)), record: true });
    }
  }
  for (const e of events || []) {
    const at = when(e.at);
    const what = at && at <= now + MIN ? eventLine(e, name) : null;   // nothing dated after "now"
    if (what && now - at < ACTIVITY_HOURS * 3600000 + MIN) items.push({ at, where: whereOf(e), what });
  }
  if (!items.length) return tracking === 'ok' ? null : { window: `last ${ACTIVITY_HOURS} hours`, lines: [], click_tracking: tracking };
  items.sort((a, b) => b.at - a.at);
  // the same action again right after (tapping a box three times, a double event) is one line
  const merged = [];
  for (const it of items) {
    const prev = merged[merged.length - 1];
    const side = (w) => String(w).split(',')[0];   // app / website / our records
    if (prev && side(prev.where) === side(it.where) && prev.what === it.what && prev.at - it.at < 10 * MIN) { prev.times += 1; if (it.where.length > prev.where.length) prev.where = it.where; continue; }
    // a save shows twice (the site's own event + our records): keep our records, it has the details
    if (!it.record && /^their edit of /.test(it.what) && items.some((o) => o.record && Math.abs(o.at - it.at) < 2 * MIN)) continue;
    merged.push({ ...it, times: 1 });
  }
  const lines = merged.slice(0, maxLines).map((it) => cut(`${ago(it.at, now)} · ${it.where} · ${it.what}${it.times > 1 ? ` (×${it.times})` : ''}`, MAX_LINE));
  return {
    window: `what they did in the last ${ACTIVITY_HOURS} hours (and saved edits of the last ${EDIT_LOG_DAYS} days), newest first; times are relative to now`,
    lines,
    ...(merged.length > maxLines ? { older_lines_left_out: merged.length - maxLines } : {}),
    ...(tracking === 'ok' ? {} : { click_tracking: tracking }),
  };
}

// ── fetching the click tracking without ever holding a reply back ────────────────────────────
// run(query) → PostHog rows (lib/posthogHogql.js, cached per person for a couple of minutes).
// Slower than timeoutMs, or failed → { events: null, tracking: why }: the reply goes out with
// what our own records show. A slow query keeps running behind and fills the cache for the next message.
export const TRACKING_SLOW = 'the click tracking did not answer in time — only our own records are shown';
export const TRACKING_DOWN = 'the click tracking is unavailable right now — only our own records are shown';
export async function loadPersonEvents({ userId, email, run, timeoutMs = 4000 } = {}) {
  const query = activityQuery({ userId, email });
  if (!query || !run) return { events: null, tracking: TRACKING_DOWN };
  let timer;
  const slow = new Promise((resolve) => { timer = setTimeout(() => resolve('slow'), timeoutMs); });
  try {
    const rows = await Promise.race([Promise.resolve().then(() => run(query)), slow]);
    if (rows === 'slow') return { events: null, tracking: TRACKING_SLOW };
    return { events: rowsToEvents(Array.isArray(rows) ? rows : []), tracking: 'ok' };
  } catch {
    return { events: null, tracking: TRACKING_DOWN };
  } finally { clearTimeout(timer); }
}
