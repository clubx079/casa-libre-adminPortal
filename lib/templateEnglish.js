// English versions of the built-in email templates, for the admin only (the team reads
// English; sellers get the Spanish email — nothing here is sent or saved). Keyed by the
// template `key`. Each field keeps the Spanish default it translates (`es`), so a field
// an admin has since reworded gets no stale English: it returns null and the caller
// falls back to the translate route (lib/translate.js). Custom templates (key null)
// always go through the translate route. Pure — test/templateEnglish.test.js.

export const TEMPLATE_FIELDS = ['subject', 'heading', 'body', 'button_label'];

// { name, subject, heading, body, button_label } each as { es, en }.
export const TEMPLATE_EN = {
  'first-listing-gift': {
    name: { es: 'Primera publicación — regalo portada', en: 'First listing — free home-page gift' },
    subject: { es: '{{name}}, tenés un regalo: tu propiedad en la portada', en: '{{name}}, you have a gift: your property on the home page' },
    heading: { es: 'Verificá tu publicación y destacala gratis', en: 'Verify your listing and feature it for free' },
    body: {
      es: 'Hola {{name}},\n\nGracias por publicar tu primera propiedad en Casa Libre. Como regalo, queremos destacar **{{property_title}}** en la portada del sitio durante {{free_days}} días, gratis.\n\nSolo tenés que verificar tu publicación con el botón de abajo: al instante queda destacada en la portada, donde la ven más compradores.\n\nEl regalo está disponible por 14 días.',
      en: 'Hi {{name}},\n\nThank you for listing your first property on Casa Libre. As a gift, we want to feature **{{property_title}}** on the site’s home page for {{free_days}} days, free.\n\nJust verify your listing with the button below: it is featured on the home page right away, where more buyers see it.\n\nThe gift is available for 14 days.',
    },
    button_label: { es: 'Verificar mi publicación', en: 'Verify my listing' },
  },
  'first-listing-ending': {
    name: { es: 'Primera publicación — fin de portada gratis', en: 'First listing — free home-page time ending' },
    subject: { es: 'Tu propiedad deja la portada el {{free_until}}', en: 'Your property leaves the home page on {{free_until}}' },
    heading: { es: 'Quedan {{days_left}} días en la portada', en: '{{days_left}} days left on the home page' },
    body: {
      es: 'Hola {{name}},\n\nTu período gratis en la portada de Casa Libre para **{{property_title}}** termina el **{{free_until}}**.\n\nSi querés seguir frente a todos los compradores, extendelo 30 días más por {{price}}. Los días se suman al final del período gratis.',
      en: 'Hi {{name}},\n\nYour free time on the Casa Libre home page for **{{property_title}}** ends on **{{free_until}}**.\n\nIf you want to stay in front of every buyer, extend it 30 more days for {{price}}. The days are added to the end of the free period.',
    },
    button_label: { es: 'Extender por {{price}}', en: 'Extend for {{price}}' },
  },
  'listing-views': {
    name: { es: 'Tu propiedad tiene visitas', en: 'Your property is getting views' },
    subject: { es: '{{property_title}} ya tiene {{views}} visitas', en: '{{property_title}} already has {{views}} views' },
    heading: { es: 'Tu propiedad está llamando la atención', en: 'Your property is getting attention' },
    body: {
      es: 'Hola {{name}},\n\nTu publicación [{{property_title}}]({{property_url}}) ya recibió **{{views}} visitas** en Casa Libre. Los compradores la están mirando.\n\n¿Tenés otra propiedad? Publicala gratis y llegá a los mismos compradores.',
      en: 'Hi {{name}},\n\nYour listing [{{property_title}}]({{property_url}}) has already had **{{views}} views** on Casa Libre. Buyers are looking at it.\n\nDo you have another property? List it for free and reach the same buyers.',
    },
    button_label: { es: 'Publicar otra propiedad', en: 'List another property' },
  },
  'draft-reminder': {
    name: { es: 'Borrador sin terminar — recordatorio', en: 'Unfinished draft — reminder' },
    subject: { es: 'Te falta poco para publicar tu propiedad', en: 'You’re almost done listing your property' },
    heading: { es: 'Tu propiedad está casi lista', en: 'Your property is almost ready' },
    body: {
      es: 'Hola {{name}},\n\nEmpezaste a publicar **{{property_title}}** en Casa Libre y quedó guardada como borrador. Lo que cargaste sigue ahí.\n\n![{{property_title}}]({{photo_url}})\n\nTe falta poco: tocá el botón y seguí justo donde lo dejaste. Publicar es gratis.',
      en: 'Hi {{name}},\n\nYou started listing **{{property_title}}** on Casa Libre and it was saved as a draft. Everything you entered is still there.\n\n![{{property_title}}]({{photo_url}})\n\nYou’re nearly there: tap the button and pick up right where you left off. Listing is free.',
    },
    button_label: { es: 'Continuar mi publicación', en: 'Continue my listing' },
  },
  'duplicate-listing': {
    name: { es: 'Propiedad publicada más de una vez', en: 'Duplicate listing' },
    subject: { es: 'Publicaste la misma propiedad más de una vez', en: 'You listed the same property more than once' },
    heading: { es: 'Notamos una publicación repetida', en: 'We noticed a repeated listing' },
    body: {
      es: 'Hola {{name}},\n\nNotamos que publicaste **{{property_title}}** {{listing_count}} veces en Casa Libre, con los mismos datos:\n\n{{listing_links}}\n\nPara que los compradores no vean la misma propiedad repetida, te recomendamos dejar una sola publicación y eliminar las demás desde Mis publicaciones.',
      en: 'Hi {{name}},\n\nWe noticed you listed **{{property_title}}** {{listing_count}} times on Casa Libre, with the same details:\n\n{{listing_links}}\n\nSo buyers don’t see the same property repeated, we recommend keeping one listing and deleting the others from My listings.',
    },
    button_label: { es: 'Ir a Mis publicaciones', en: 'Go to My listings' },
  },
  // Signed up but never listed (lib/noListingAdmin.js NO_LISTING_TEMPLATES).
  'no-listing-welcome': {
    name: { es: 'Bienvenida — publicá tu primera propiedad gratis', en: 'Welcome — post your first listing for free' },
    subject: { es: 'Bienvenido a Casa Libre — publicá tu primera propiedad gratis ahora', en: 'Welcome to Casa Libre — post your first listing for free now' },
    heading: { es: 'Bienvenido a Casa Libre', en: 'Welcome to Casa Libre' },
    body: {
      es: 'Hola {{name}},\n\nGracias por crear tu cuenta en Casa Libre. Todavía no publicaste ninguna propiedad: publicá la primera **gratis** ahora, antes de que sea tarde.\n\nLleva solo unos minutos. Tu propiedad aparece al instante en el mapa y los interesados te escriben directo, sin comisiones.',
      en: 'Hi {{name}},\n\nThank you for creating your Casa Libre account. You haven’t listed a property yet: post your first one **for free** now, before it’s too late.\n\nIt only takes a few minutes. Your property shows up on the map straight away and interested people contact you directly, with no commissions.',
    },
    button_label: { es: 'Publicar gratis ahora', en: 'List for free now' },
  },
  'no-listing-reminder': {
    name: { es: 'Sin publicaciones — recordatorio', en: 'No listing yet — reminder' },
    subject: { es: 'Tu primera publicación gratis te está esperando', en: 'Your free first listing is waiting for you' },
    heading: { es: 'No te quedes afuera', en: 'Don’t miss out' },
    body: {
      es: 'Hola {{name}},\n\nTe registraste en Casa Libre hace unos días y todavía no publicaste tu propiedad. Tu primera publicación sigue siendo **gratis**: aprovechala ahora, antes de que sea tarde.\n\nSubí tus fotos, marcá la ubicación y listo. Miles de personas buscan propiedades en Casa Libre cada mes.',
      en: 'Hi {{name}},\n\nYou signed up to Casa Libre a few days ago and haven’t listed your property yet. Your first listing is still **free**: make the most of it now, before it’s too late.\n\nUpload your photos, mark the location and you’re done. Thousands of people look for properties on Casa Libre every month.',
    },
    button_label: { es: 'Publicar mi propiedad', en: 'List my property' },
  },
  // Paid listings (lib/paidListingsAdmin.js DEFAULT_TEMPLATES): names were created in English.
  'paid-listing-ending': {
    name: { es: 'Paid listing — ends soon', en: 'Paid listing — ends soon' },
    subject: { es: 'Tu publicación termina en {{days_left}} días', en: 'Your listing ends in {{days_left}} days' },
    heading: { es: 'Tu publicación termina pronto', en: 'Your listing ends soon' },
    body: {
      es: 'Hola {{name}},\n\nTu publicación **{{property_title}}** está en Casa Libre hasta el {{listing_until}}.\n\nSi todavía no la vendiste o alquilaste, extendela {{free_days}} días más por {{price}} y seguí recibiendo consultas.',
      en: 'Hi {{name}},\n\nYour listing **{{property_title}}** is on Casa Libre until {{listing_until}}.\n\nIf you haven’t sold or rented it yet, extend it {{free_days}} more days for {{price}} and keep getting enquiries.',
    },
    button_label: { es: 'Extender mi publicación', en: 'Extend my listing' },
  },
  'paid-listing-ended': {
    name: { es: 'Paid listing — ended', en: 'Paid listing — ended' },
    subject: { es: 'Tu publicación terminó', en: 'Your listing has ended' },
    heading: { es: 'Tu publicación ya no está en el sitio', en: 'Your listing is no longer on the site' },
    body: {
      es: 'Hola {{name}},\n\nEl tiempo de tu publicación **{{property_title}}** terminó el {{listing_until}} y ya no aparece en Casa Libre.\n\nExtendela {{free_days}} días por {{price}} y vuelve a publicarse al instante.',
      en: 'Hi {{name}},\n\nThe time for your listing **{{property_title}}** ended on {{listing_until}} and it no longer appears on Casa Libre.\n\nExtend it {{free_days}} days for {{price}} and it goes live again straight away.',
    },
    button_label: { es: 'Volver a publicar', en: 'List it again' },
  },
  'agent-plan': {
    name: { es: 'Plan for agents', en: 'Plan for agents' },
    subject: { es: 'Un plan para agentes e inmobiliarias', en: 'A plan for agents and real-estate agencies' },
    heading: { es: '¿Publicás muchas propiedades?', en: 'Do you list a lot of properties?' },
    body: {
      es: 'Hola {{name}},\n\nVimos que ya usaste tus {{free_limit}} publicaciones gratis de este mes. Si trabajás como agente o con una inmobiliaria, estamos preparando un plan para publicar más propiedades por mes.\n\nContanos qué necesitás y te avisamos primero.',
      en: 'Hi {{name}},\n\nWe saw you have already used your {{free_limit}} free listings this month. If you work as an agent or with a real-estate agency, we are preparing a plan to list more properties per month.\n\nTell us what you need and we will let you know first.',
    },
    button_label: { es: 'Quiero saber más', en: 'I want to know more' },
  },
};

const norm = (s) => String(s ?? '').replace(/\r\n?/g, '\n').trim();

// The fixed English for one field, or null when there is none (custom template,
// unknown key) or the stored Spanish no longer matches the default it translates.
function fixedField(key, field, value) {
  const f = TEMPLATE_EN[key]?.[field];
  if (!f) return null;
  const v = norm(value);
  if (!v) return '';
  return v === norm(f.es) || v === norm(f.en) ? f.en : null;
}

// English name of a template, or null when it has to be translated.
export function englishName(t) {
  return t?.key ? fixedField(t.key, 'name', t.name) || null : null;
}

// Fixed English text fields of a template: { subject, heading, body, button_label },
// each a string or null (null = reworded or custom → translate it).
export function fixedEnglish(t) {
  const out = {};
  for (const f of TEMPLATE_FIELDS) out[f] = t?.key ? fixedField(t.key, f, t[f]) : null;
  return out;
}

// Dropdown text: "Duplicate listing (Propiedad publicada más de una vez)". Spanish only
// when there is no English yet, once when both are the same.
export function templateOptionLabel(name, en) {
  const es = String(name ?? '').trim();
  const e = String(en ?? '').trim();
  if (!e || e.toLowerCase() === es.toLowerCase()) return es;
  return es ? `${e} (${es})` : e;
}
