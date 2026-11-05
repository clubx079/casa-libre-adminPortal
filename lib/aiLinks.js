// Every link the Inbox assistant sends is TRACKED: it goes through the website's /r/ai redirect,
// which records the click in PostHog (event link_click, slug 'ai', recipient = the person, answer
// = which reply) and then opens the page with utm_source=whatsapp & utm_medium=assistant — so the
// admin sees, per person and per reply, who clicked, landed and signed up.
//   https://casa-libre.com.py/r/ai?u=/publicar&r=<person>&a=<reply>
// Pure — test/aiLinks.test.js. The website side: app/r/[slug]/route.js (slug 'ai').
import { recipientRef } from './waCampaigns.js';

// the person's code: the same function as the campaigns use (on their E.164 phone)
export const aiRef = (phone) => {
  const d = String(phone || '').replace(/\D/g, '');
  return d ? recipientRef(`+${d}`) : '';
};
// a short code for one reply: the inbound message it answers (msg_… → last 10), or a manual one
export const answerRef = (inboundId) => String(inboundId || '').replace(/[^a-z0-9]/gi, '').slice(-10).toLowerCase() || `m${Date.now().toString(36)}`;

// site page path → the tracked link. Only same-site paths (never another domain).
export function aiLink(site, path, { ref = '', answer = '' } = {}) {
  const base = String(site || '').replace(/\/$/, '');
  const p = String(path || '/');
  if (!p.startsWith('/') || p.startsWith('//')) return `${base}/`;
  const q = new URLSearchParams({ u: p, ...(ref ? { r: ref } : {}), ...(answer ? { a: answer } : {}) });
  return `${base}/r/ai?${q.toString().replace(/%2F/g, '/')}`;
}

// The pages the assistant may link to, per site (paths exist on every country's site).
export const SITE_PAGES = {
  publish_a_property: '/publicar',
  my_listings: '/cuenta/publicaciones',
  my_drafts: '/cuenta/publicaciones?tab=borradores',
  rejected_photos: '/cuenta/publicaciones?tab=rechazadas',
  sign_in_or_sign_up: '/cuenta',
  saved_properties: '/guardadas',
  buy: '/comprar',
  rent: '/alquilar',
  how_it_works: '/como-funciona',
  sell_guide: '/vender',
  faq: '/preguntas-frecuentes',
  guides: '/guias',
  for_agencies_and_developers: '/empresas',
  download_the_app: '/descargar',   // a phone goes straight to its own store (App Store / Google Play)
  contact: '/contacto',
  home: '/',
};
