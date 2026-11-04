// Admin Manager — "views but no contacts" (AI Operations Plan; Roland, 2 Nov: "your property is
// getting a lot of views, but if no one's contacting you, consider a price reduction").
// Every report run (lib/manager/run.js) finds the sellers' live listings that got many views in
// the last days and no (or very few) buyer contacts, and emails each seller the numbers and the
// advice (price, photos) with a link to My listings — once per listing every REPEAT_DAYS. No
// automation of its own: it is the manager doing it, and the report says who got it and, a week
// later, whether a buyer wrote (dataPack 'viewsAdvice'; Open issues escalates the ones that stay
// silent). MANAGER_AUTO_SEND=0 → nothing is sent; Open issues lists them to send by hand.
// Logged in email_log as automation 'manager_views', dedupe "mviews:<listing>:<yyyy-mm-dd>".
// WhatsApp first: when the seller has a number, the country sends WhatsApp (WA_COUNTRIES), they
// didn't opt out and Meta APPROVED the template cl_visitas_sin_contacto (Relay), the same message
// goes as that template instead of the email (row channel 'whatsapp' + relay_message_id).
// Pure except sendViewsAdvice (viewsAdviceRun.js) — test/viewsAdvice.test.js.
import { WA_COUNTRIES, WA_LANGUAGE, waVariables } from '../whatsappTemplates.js';
import { PHONE_PREFIX, toE164 } from '../paidListingsAdmin.js';

export const ADVICE_ID = 'manager_views';
export const ADVICE_WA = 'cl_visitas_sin_contacto';
export const ADVICE = Object.freeze({ minViews: 20, days: 14, maxContactPct: 2, repeatDays: 30, minAgeDays: 3, perRun: 30 });
const D = 86400000;

const first = (full) => String(full || '').trim().split(/\s+/)[0] || '';
const titulo = (p) => [p?.property_type, p?.neighborhood || p?.city].filter(Boolean).join(' en ') || 'tu propiedad';
export const contactsText = (n) => (n <= 0 ? 'todavía ningún comprador te escribió' : n === 1 ? 'solo 1 comprador te escribió' : `solo ${n} compradores te escribieron`);
export const qualifies = (views, contacts, s = ADVICE) => views >= s.minViews && (s.maxContactPct === 0 ? contacts === 0 : (contacts / views) * 100 < s.maxContactPct);
export const listingOfKey = (key) => String(key || '').split(':')[1] || null;

// → [{ listing, user, views, contacts }] to email now (most views first, at most perRun)
export function pickAdvice({ listings = [], views = new Map(), contacts = new Map(), users = new Map(), recentlyAdvised = new Set(), now = Date.now(), isInternal = () => false, settings = {} }) {
  const s = { ...ADVICE, ...settings };
  const out = [];
  for (const l of listings) {
    if (l.admin_status !== 'active' || (l.status && l.status !== 'published')) continue;
    if (now - Date.parse(l.created_at) < s.minAgeDays * D) continue;
    if (recentlyAdvised.has(String(l.id))) continue;
    const u = users.get(String(l.created_by));
    if ((!u?.email && !u?.phone) || u.suspended || u.blocked || u.active === false || (u.email && isInternal(u.email))) continue;
    const v = Number(views.get(String(l.id)) || 0);
    const c = Number(contacts.get(String(l.id)) || 0);
    if (!qualifies(v, c, s)) continue;
    out.push({ listing: l, user: u, views: v, contacts: c });
  }
  return out.sort((a, b) => b.views - a.views).slice(0, s.perRun);
}

// The email (Spanish, voseo, Casa-Libre with the hyphen, no emojis) — Roland's message.
export function adviceEmail({ user, listing, views, contacts, days = ADVICE.days, site = '' }) {
  const hi = first(user?.full_name) ? `Hola ${first(user.full_name)}` : 'Hola';
  const link = `${String(site).replace(/\/$/, '')}/cuenta/publicaciones`;
  const subject = `${first(user?.full_name) ? `${first(user.full_name)}, tu` : 'Tu'} propiedad tuvo ${views} visitas`;
  const paras = [
    `${hi},`,
    `Tu publicación ${titulo(listing)} tuvo ${views} visitas en Casa-Libre en los últimos ${days} días, pero ${contactsText(contacts)}.`,
    'Cuando una propiedad se ve mucho y no recibe mensajes, casi siempre es por el precio o por las fotos. Compará tu precio con propiedades parecidas de la zona y sumá fotos claras del frente y de los ambientes principales: suele hacer la diferencia.',
    `Podés editar tu publicación acá: ${link}`,
    'El equipo de Casa-Libre',
  ];
  const esc = (x) => String(x).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
  const html = paras.map((p) => `<p>${esc(p).replace(esc(link), `<a href="${link}">Editar publicación</a>`)}</p>`).join('');
  return { subject, text: paras.join('\n\n'), html, link };
}

// Relay's template list ({ name, language, status }[]) → is cl_visitas_sin_contacto approved?
export const adviceWaApproved = (templates = []) =>
  templates.some((t) => t?.name === ADVICE_WA && String(t.status || '').toUpperCase() === 'APPROVED' && (!t.language || t.language === WA_LANGUAGE));

// The template's variables (same words as the email): {{1}} first name · {{2}} listing ·
// {{3}} views · {{4}} days · {{5}} "todavía ningún comprador te escribió". null when one is
// missing (no first name → email).
export function adviceWhatsApp({ user, listing, views, contacts, days = ADVICE.days }) {
  return waVariables(ADVICE_WA, { name: first(user?.full_name), property_title: titulo(listing), views: String(views), days: String(days), contacts_text: contactsText(contacts) });
}

// → { channel: 'whatsapp', to: '+595…', variables } or { channel: 'email' }.
// approved = adviceWaApproved(Relay list); testTo = send every WhatsApp to that number instead.
export function adviceChannel({ user, listing, views, contacts, days = ADVICE.days, country, approved = false, testTo = '' }) {
  const email = { channel: 'email' };
  const c = String(country || '').toLowerCase();
  if (!approved || !WA_COUNTRIES.includes(c) || user?.whatsapp_opted_out_at) return email;
  const to = toE164(testTo || user?.phone, PHONE_PREFIX[c]);
  if (!to) return email;
  const variables = adviceWhatsApp({ user, listing, views, contacts, days });
  return variables ? { channel: 'whatsapp', to, variables } : email;
}
