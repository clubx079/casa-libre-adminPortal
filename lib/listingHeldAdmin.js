// "Listing not published" — admin side (the buyer portal sends it hourly:
// lib/automations/listingHeld.js there, from /api/cron/automations).
// A user listing held off the site — waiting for payment, photos rejected, paused by an
// admin, missing details — gets a message telling the owner why, with a button to
// My listings. Settings = the `automations` row 'listing_held':
//   enabled / enabled_at · milestones = HOURS after the listing was held: [first, reminder?]
// The four emails are email_templates found by key (listing-held-payment / -photos /
// -paused / -incomplete); switching one off in Templates skips that reason.
// Nothing is written until an admin saves the card; the first save creates the row and
// the four default (Spanish) emails. Pure except saveListingHeld (db passed in).

export const LISTING_HELD_ID = 'listing_held';
export const HELD_REASONS = [
  { reason: 'payment', key: 'listing-held-payment', label: 'Waiting for payment' },
  { reason: 'photos', key: 'listing-held-photos', label: 'Photos rejected' },
  { reason: 'paused', key: 'listing-held-paused', label: 'Paused by an admin' },
  { reason: 'incomplete', key: 'listing-held-incomplete', label: 'Missing details' },
];
export const HELD_DEFAULT_HOURS = 3;
export const HELD_MAX_HOURS = 720;

const int = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

// The row → the card's fields. reminderAfter = extra hours after the first message ('' = none).
export function listingHeldConfig(row) {
  const m = (Array.isArray(row?.milestones) ? row.milestones : []).map(Number).filter((n) => Number.isInteger(n) && n > 0).sort((a, b) => a - b);
  const hours = m[0] || HELD_DEFAULT_HOURS;
  return { enabled: row?.enabled === true, enabledAt: row?.enabled_at || null, hours, reminderAfter: m[1] ? m[1] - hours : (row ? '' : 45) };
}

export function validateListingHeld(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = listingHeldConfig(currentRow);
  const errors = {};
  const hours = input.hours !== undefined ? int(input.hours) : cur.hours;
  if (!Number.isInteger(hours) || hours < 1 || hours > HELD_MAX_HOURS) errors.hours = `Between 1 and ${HELD_MAX_HOURS} hours.`;
  const raw = input.reminderAfter !== undefined ? input.reminderAfter : cur.reminderAfter;
  const rem = raw === '' || raw == null || Number(raw) === 0 ? null : int(raw);
  if (rem !== null && (!Number.isInteger(rem) || rem < 1)) errors.reminderAfter = 'A whole number of hours, 1 or more — or leave it empty for no reminder.';
  else if (rem !== null && !errors.hours && hours + rem > HELD_MAX_HOURS) errors.reminderAfter = `The reminder must go out within ${HELD_MAX_HOURS} hours (30 days).`;
  const value = { milestones: rem && !errors.hours && !errors.reminderAfter ? [hours, hours + rem] : [errors.hours ? cur.hours : hours], wait_days: 0 };
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// The four emails (Spanish — edit them in Templates). Each has the My listings button.
export const LISTING_HELD_TEMPLATES = [
  {
    key: 'listing-held-payment', name: 'Publicación no publicada — falta el pago',
    subject: 'Tu publicación está guardada, falta un paso para publicarla', heading: 'Tu publicación todavía no está visible',
    body: 'Hola {{name}},\n\nTu publicación **{{property_title}}** está guardada pero todavía no aparece en Casa Libre: ya usaste tus {{free_limit}} publicaciones gratis de este mes.\n\nPodés publicarla ahora por **{{price}}** y queda visible {{paid_days}} días. Entrá a Mis publicaciones y tocá "Pagar y publicar".',
    button_label: 'Publicar ahora', button_url: '{{my_listings_url}}',
  },
  {
    key: 'listing-held-photos', name: 'Publicación no publicada — fotos rechazadas',
    subject: 'Tu publicación no está visible: revisá las fotos', heading: 'Algunas fotos no pasaron la revisión',
    body: 'Hola {{name}},\n\nTu publicación **{{property_title}}** todavía no aparece en Casa Libre porque algunas fotos no pasaron nuestra revisión automática.\n\nSuele pasar con fotos que tienen texto, logos o marcas de agua, capturas de pantalla, o que no muestran la propiedad. Cambiá esas fotos desde Mis publicaciones y la revisamos de nuevo enseguida.',
    button_label: 'Cambiar las fotos', button_url: '{{my_listings_url}}',
  },
  {
    key: 'listing-held-paused', name: 'Publicación no publicada — pausada',
    subject: 'Tu publicación fue pausada', heading: 'Pausamos tu publicación',
    body: 'Hola {{name}},\n\nTu publicación **{{property_title}}** fue pausada y por ahora no aparece en Casa Libre.\n\nRevisala desde Mis publicaciones. Si tenés dudas o querés que la revisemos de nuevo, respondé este correo.',
    button_label: 'Ver mis publicaciones', button_url: '{{my_listings_url}}',
  },
  {
    key: 'listing-held-incomplete', name: 'Publicación no publicada — faltan datos',
    subject: 'A tu publicación le faltan datos', heading: 'Completá tu publicación',
    body: 'Hola {{name}},\n\nTu publicación **{{property_title}}** todavía no aparece en Casa Libre porque le faltan datos: **{{missing}}**.\n\nCompletalos desde Mis publicaciones y la publicamos.',
    button_label: 'Completar mi publicación', button_url: '{{my_listings_url}}',
  },
];

// Save the card (the API route's PUT). First save: creates the four default emails
// (unless this country already has them, by key) and inserts the row.
export async function saveListingHeld(db, input = {}, nowIso = new Date().toISOString()) {
  const [cur] = await db.select('automations', `select=*&id=eq.${LISTING_HELD_ID}&limit=1`);
  if (!cur) {
    const existing = await db.select('email_templates', 'select=id,key');
    for (const t of LISTING_HELD_TEMPLATES) {
      if (!existing.find((e) => e.key === t.key)) await db.insert('email_templates', [{ ...t, is_active: true }], { returning: 'minimal' });
    }
  }
  const v = validateListingHeld(input, cur || null, nowIso);
  if (!v.ok) return v;
  if (cur) await db.update('automations', `id=eq.${LISTING_HELD_ID}`, { ...v.value, updated_at: nowIso }, { returning: 'minimal' });
  else await db.insert('automations', [{ id: LISTING_HELD_ID, ...v.value, updated_at: nowIso }], { returning: 'minimal' });
  return { ...v, created: !cur };
}

// Sent messages per reason, from email_log dedupe keys held:<property>:<reason>:<step>.
export function listingHeldCounts(logs = []) {
  const per = {};
  for (const l of logs) {
    const m = /^held:[^:]+:([a-z]+):\d+$/.exec(String(l?.dedupe_key || ''));
    if (m) per[m[1]] = (per[m[1]] || 0) + 1;
  }
  return per;
}
