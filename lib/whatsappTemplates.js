// The WhatsApp templates (Relay → Meta) that can stand in for an automation email, and
// how to fill them from the SAME vars the email gets (lib/automations/*.js). Pure, so
// it is unit-tested. SAME FILE as the buyer portal's lib/whatsappTemplates.js (that one sends).
//   body   → the email var for {{1}}, {{2}}… in order (an empty one = don't send it)
//   button → the URL button's variable: the part of an email link after `after`
//            (the template holds the fixed start, e.g. https://casa-libre.com.py/propiedad/)
//   countries → the button links are on these sites only (Paraguay for now)
// category = Meta's verdict (it moved several to Marketing); the senders read the live
// category from Relay and use this only as a fallback.
export const WA_TEMPLATES = {
  cl_destacado_inicio: { category: 'marketing', body: ['name', 'property_title', 'free_until'], button: { var: 'property_url', after: '/propiedad/' } },
  cl_destacado_fin: { category: 'marketing', body: ['name', 'property_title', 'free_until', 'price'], button: { var: 'extend_url', after: 'token=' } },
  cl_visitas: { category: 'marketing', body: ['name', 'property_title', 'views'], button: { var: 'property_url', after: '/propiedad/' } },
  cl_borrador: { category: 'utility', body: ['name', 'property_title'], button: { var: 'draft_url', after: 'draft=' } },
  cl_repetida: { category: 'utility', body: ['name', 'property_title', 'listing_count'] },
  cl_publicacion_vence: { category: 'utility', body: ['name', 'property_title', 'listing_until', 'free_days', 'price'], button: { var: 'extend_url', after: 'extend=' } },
  cl_publicacion_termino: { category: 'marketing', body: ['name', 'property_title', 'listing_until', 'free_days', 'price'], button: { var: 'extend_url', after: 'extend=' } },
  cl_plan_agentes: { category: 'marketing', body: ['name', 'free_limit'] },
  cl_cuenta_lista: { category: 'utility', body: ['name'] },
  cl_sin_publicar: { category: 'marketing', body: ['name'] },
};
export const WA_COUNTRIES = ['py'];
export const WA_LANGUAGE = 'es_MX';
export const CHANNELS = ['email', 'whatsapp', 'both'];

// WhatsApp variables: no line breaks / tabs / runs of spaces, at most 200 characters.
const clean = (v) => String(v ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim().slice(0, 200);

// → { body: [...], buttons?: [{ index: 0, text }] } or null when a value is missing.
export function waVariables(name, vars = {}) {
  const spec = WA_TEMPLATES[name];
  if (!spec) return null;
  const body = spec.body.map((k) => clean(vars[k]));
  if (body.some((v) => !v)) return null;
  const out = { body };
  if (spec.button) {
    const url = String(vars[spec.button.var] || '');
    const at = url.indexOf(spec.button.after);
    if (at < 0) return null;
    let suffix = url.slice(at + spec.button.after.length);
    try { suffix = decodeURIComponent(suffix); } catch { /* keep as is */ }
    if (!suffix) return null;
    out.buttons = [{ index: 0, text: suffix }];
  }
  return out;
}

// Can this person get this template? Utility: a number proven by a WhatsApp code or a
// WhatsApp consent. Marketing: the consent only. Never after an opt-out.
export function waAllowed(user, category) {
  if (!user || user.whatsapp_opted_out_at) return false;
  if (category === 'marketing') return !!user.whatsapp_opt_in_at;
  return !!(user.whatsapp_opt_in_at || user.phone_verified_at);
}

// Normalised automation channel ('email' unless WhatsApp was picked).
export const channelOf = (automation) => (CHANNELS.includes(automation?.channel) ? automation.channel : 'email');

// The WhatsApp template made for each built-in email (email_templates.key), offered first
// in the admin pickers.
export const SUGGESTED_WA = {
  'first-listing-gift': 'cl_destacado_inicio',
  'first-listing-ending': 'cl_destacado_fin',
  'listing-views': 'cl_visitas',
  'draft-reminder': 'cl_borrador',
  'duplicate-listing': 'cl_repetida',
  'paid-listing-ending': 'cl_publicacion_vence',
  'paid-listing-ended': 'cl_publicacion_termino',
  'agent-plan': 'cl_plan_agentes',
  'no-listing-welcome': 'cl_cuenta_lista',
  'no-listing-reminder': 'cl_sin_publicar',
};
