// Admin Manager — reminders on "you started paying and it didn't go through" emails
// (kind unpaid_listing). The AI (or the team) writes the first email; from then on CODE keeps
// track, like the listing-fix reminders (fixFollowups.js):
//   • paid = a successful payment for that listing after our first email, or (Verified / home
//     page) the listing was promoted after it, or (a listing waiting for payment) it is no
//     longer waiting — published by paying, as a gift or with the next month's free listings —
//     or the listing is gone → nothing more;
//   • not paid → a reminder with each report (at least MIN_GAP_H apart), up to MAX_SENDS emails
//     in all (the first + 3 reminders), each with a button that opens THAT payment directly;
//   • still not paid after MAX_SENDS → an action for Omar in every report until it is.
// What they were paying for comes from the first email's button (?pay=…&plan=…, ?pay_listing=),
// else their checkout rows in `payments`, else whether the listing is waiting for payment.
// Pure (the run passes the data in) — test/managerPayFollowups.test.js.

export const PAY_KINDS = ['unpaid_listing'];
export const MAX_SENDS = 4;
export const MIN_GAP_H = 40;
export const LOOKBACK_DAYS = 60;
const H = 3600e3;

const fmtDate = (iso) => new Date(iso).toLocaleDateString('es-PY', { day: 'numeric', month: 'long', timeZone: 'America/Asuncion' });
const firstName = (s) => { const f = String(s || '').trim().split(/\s+/)[0] || ''; return f ? f[0].toUpperCase() + f.slice(1).toLowerCase() : ''; };
const t = (iso) => Date.parse(iso || 0) || 0;

// Every payment email sent, per person + listing, oldest first.
export function payThreads(reports = []) {
  const threads = new Map();
  for (const r of reports) {
    for (const a of r.actions || []) {
      if (a.status !== 'sent' || !PAY_KINDS.includes(a.kind) || !a.user_id || !a.property_id) continue;
      const key = `${a.user_id}:${a.property_id}`;
      const th = threads.get(key) || { key, user_id: a.user_id, property_id: a.property_id, sends: [] };
      th.sends.push({ at: a.sent_at || r.created_at, subject: a.subject, reason: a.reason || '', button_url: a.button_url || '', plan: a.plan || null });
      threads.set(key, th);
    }
  }
  for (const th of threads.values()) th.sends.sort((x, y) => t(x.at) - t(y.at));
  return threads;
}

// What they were paying for: 'verified' | 'home' | 'listing' (an extra listing) | 'extend' (more
// days for a paid listing) | 'promo' (a promotion, plan unknown)
export function payKind(thread, listing, payments = []) {
  for (const s of thread.sends) {
    if (['verified', 'home', 'listing', 'extend'].includes(s.plan)) return s.plan;
    const m = /[?&]plan=(verified|home)\b/.exec(s.button_url || '');
    if (m) return m[1];
    if (/[?&]pay_listing=/.test(s.button_url || '')) return 'listing';
    if (/[?&]extend=/.test(s.button_url || '')) return 'extend';
  }
  const mine = payments.filter((p) => String(p.user_id) === String(thread.user_id) && String(p.property_id) === String(thread.property_id) && p.status === 'started')
    .sort((a, b) => t(b.created_at) - t(a.created_at));
  if (mine[0]) return planOfPayment(mine[0]);
  return listing?.status === 'payment_pending' ? 'listing' : 'promo';
}

// A checkout row (payments, status 'started') → what it was for
export const planOfPayment = (p) => (p?.kind === 'highlight' ? (p.plan === 'home' ? 'home' : p.plan === 'verified' ? 'verified' : 'promo') : p?.kind === 'listing_extend' ? 'extend' : 'listing');

// Has it been paid (or stopped mattering) since our first email?
export function isPaid(thread, listing, payments = []) {
  if (!listing || ['deleted', 'inactive', 'sold', 'rented'].includes(String(listing.status || '').toLowerCase())) return true;
  const first = t(thread.sends[0]?.at);
  if (payments.some((p) => p.status === 'succeeded' && String(p.user_id) === String(thread.user_id) && String(p.property_id) === String(thread.property_id) && t(p.created_at) >= first)) return true;
  const kind = payKind(thread, listing, payments);
  if (kind === 'listing') return listing.status !== 'payment_pending';
  if (kind === 'extend') return false;   // only a payment closes it (above)
  return t(listing.promoted_at) >= first;   // Verified / home page bought after our email
}

// → { resend: [thread], escalate: [thread] }
export function planPayFollowups(threads, listingsById, payments = [], now = Date.now()) {
  const resend = [], escalate = [];
  for (const th of threads.values()) {
    if (!th.sends.length || isPaid(th, listingsById.get(String(th.property_id)), payments)) continue;
    const last = t(th.sends[th.sends.length - 1].at);
    if (th.sends.length >= MAX_SENDS) escalate.push(th);
    else if (now - last >= MIN_GAP_H * H) resend.push(th);
  }
  return { resend, escalate };
}

export function listingLabel(l) {
  const where = l?.neighborhood || l?.city || '';
  const type = l?.property_type || 'propiedad';
  return where ? `${type} en ${where}` : type;
}

const WHAT = {
  verified: (label) => `empezaste a agregar el sello **Verificado** a tu publicación (${label}) y el pago no se completó`,
  home: (label) => `empezaste a destacar tu publicación (${label}) en la **portada** de Casa Libre y el pago no se completó`,
  promo: (label) => `empezaste un pago para tu publicación (${label}) y no se completó`,
  listing: (label) => `tu publicación (${label}) quedó guardada esperando el pago para publicarse`,
  extend: (label) => `empezaste a extender tu publicación (${label}) y el pago no se completó`,
};
const NEXT = {
  verified: 'Si todavía querés el sello, son US$5 por 30 días: con el botón de abajo abrís el pago directo, con tarjeta, y queda listo al instante.',
  home: 'Si todavía querés aparecer en la portada, son US$20 por 30 días: con el botón de abajo abrís el pago directo, con tarjeta, y queda listo al instante.',
  promo: 'Podés retomarlo cuando quieras desde Mis publicaciones; el pago es con tarjeta y queda listo al instante.',
  listing: 'Con el botón de abajo abrís el pago directo, con tarjeta, y queda publicada al instante.',
  extend: 'Con el botón de abajo abrís el pago directo, con tarjeta, y los días se suman al instante.',
};
const BUTTON = { verified: 'Agregar el sello Verificado', home: 'Destacar en la portada', promo: 'Ver mis publicaciones', listing: 'Publicar mi propiedad', extend: 'Extender mi publicación' };

// The reminder email (Spanish, voseo — the Manager's voice). n = which email this is (2..MAX_SENDS).
export function payReminderDraft(thread, { listing, user, site, payments = [] }) {
  const n = thread.sends.length + 1;
  const first = thread.sends[0];
  const kind = payKind(thread, listing, payments);
  const name = firstName(user?.full_name || listing?.contact_name);
  const base = String(site).replace(/\/$/, '');
  const pid = thread.property_id;
  const url = kind === 'verified' || kind === 'home' ? `${base}/cuenta/publicaciones?pay=${pid}&plan=${kind}`
    : kind === 'listing' ? `${base}/cuenta/publicaciones?pay_listing=${pid}`
    : kind === 'extend' ? `${base}/cuenta/publicaciones?extend=${pid}` : `${base}/cuenta/publicaciones`;
  const original = String(first.subject || '').replace(/^((Último )?recordatorio( \d+)?: )+/i, '');
  const last = n >= MAX_SENDS;
  return {
    kind: 'unpaid_listing',
    user_id: thread.user_id,
    property_id: pid,
    plan: kind,
    followup: n - 1,
    reason: `Payment reminder ${n - 1} of ${MAX_SENDS - 1}: not paid since ${String(first.at).slice(0, 10)} — ${first.reason}`.slice(0, 300),
    evidence: `Emails sent: ${thread.sends.map((s) => String(s.at).slice(0, 10)).join(', ')}; no payment since.`,
    subject: `${last ? 'Último recordatorio' : 'Recordatorio'}: ${original}`.slice(0, 200),
    heading: '',
    body: [
      `Hola${name ? ` ${name}` : ''}:`,
      `Te escribimos el ${fmtDate(first.at)} porque ${WHAT[kind](listingLabel(listing))}.`,
      NEXT[kind],
      `Si algo no funcionó con la tarjeta o tenés alguna duda, respondé este correo y lo vemos juntos.${last ? ' Es el último recordatorio que te mandamos sobre esto.' : ''}`,
      'Un abrazo,\nEl equipo de Casa Libre',
    ].join('\n\n'),
    button_label: BUTTON[kind],
    button_url: url,
  };
}

// The action for Omar once the reminders are used up.
export function payEscalationAction(thread, { listing, user, payments = [] }) {
  const name = user?.full_name || listing?.contact_name || 'The seller';
  const kind = payKind(thread, listing, payments);
  const what = { verified: 'Verified badge (US$5)', home: 'home page promotion (US$20)', promo: 'a promotion', listing: 'a listing waiting for payment', extend: 'more days for a paid listing' }[kind];
  const dates = thread.sends.map((s) => String(s.at).slice(5, 10)).join(', ');
  return {
    key: `pay-unpaid-${String(thread.property_id).slice(0, 8)}`,
    title: `${name} hasn't paid after ${thread.sends.length} emails`,
    why: `Started paying for ${what} — ${listingLabel(listing)}. Emailed ${dates}; no payment since.`,
    how: `WhatsApp ${firstName(name) || 'them'}${listing?.contact_phone ? ` (${listing.contact_phone})` : ''}: ask what went wrong with the card.${kind === 'listing' ? ' Or publish it free as a gift (Open issues).' : ''}`,
    owner: 'Omar', area: 'listings', effort: 'small', impact: 'medium',
    facts: [], evidence: [], verified: true, unverified: [], made_by: 'code',
  };
}

// What each payment email is about, for the admin (report Emails tab, a user's emails,
// Messages & email clicks): the email is logged as template_key manager_unpaid_<what>.
export const PAY_LABEL = { verified: 'Waiting for payment: Verified badge', home: 'Waiting for payment: Home page display', listing: 'Waiting for payment: Extra listing', extend: 'Waiting for payment: Listing extension', promo: 'Waiting for payment' };
const KEY_SUFFIX = { verified: 'unpaid_verified', home: 'unpaid_home', listing: 'unpaid_extra', extend: 'unpaid_extend' };
export const unpaidKind = (plan) => KEY_SUFFIX[plan] || 'unpaid_listing';
export const payLabel = (plan) => PAY_LABEL[plan] || PAY_LABEL.promo;

// ── the FIRST email, written by code (the daily run, lib/manager/daily.js) ──
// Checkouts started (payments 'started') that need it: at least MIN_AGE_H old (they may still be
// paying), at most NEW_DAYS old, not paid since, not already bought another way, the listing
// still there (and, for an extra listing, still waiting), and no payment email to this person
// about this listing yet. One per person + listing (their latest checkout for it).
export const MIN_AGE_H = 2;
export const NEW_DAYS = 14;
export function newCheckouts({ payments = [], threadKeys = new Set(), listingsById = new Map(), now = Date.now() }) {
  const latest = new Map();
  for (const p of payments) {
    if (p.status !== 'started' || !p.user_id || !p.property_id) continue;
    const age = now - t(p.created_at);
    if (age < MIN_AGE_H * H || age > NEW_DAYS * 24 * H) continue;
    const key = `${p.user_id}:${p.property_id}`;
    if (!latest.has(key) || t(p.created_at) > t(latest.get(key).created_at)) latest.set(key, p);
  }
  const out = [];
  for (const [key, p] of latest) {
    if (threadKeys.has(key)) continue;
    const listing = listingsById.get(String(p.property_id));
    if (!listing || ['deleted', 'inactive', 'sold', 'rented'].includes(String(listing.status || '').toLowerCase())) continue;
    if (payments.some((x) => x.status === 'succeeded' && String(x.user_id) === String(p.user_id) && String(x.property_id) === String(p.property_id) && t(x.created_at) >= t(p.created_at))) continue;
    const plan = planOfPayment(p);
    if ((plan === 'verified' || plan === 'home' || plan === 'promo') && t(listing.promoted_at) >= t(p.created_at)) continue;
    if (plan === 'listing' && listing.status !== 'payment_pending') continue;
    out.push({ key, user_id: p.user_id, property_id: p.property_id, plan, started_at: p.created_at, amount_usd: p.amount_usd ?? null });
  }
  return out.sort((a, b) => t(a.started_at) - t(b.started_at));
}

const lowerType = (l) => String(l?.property_type || 'propiedad').toLowerCase();
const SUBJECT = { verified: '¿Te ayudamos con el sello Verificado?', home: '¿Te ayudamos a destacar tu propiedad en la portada?', listing: 'Tu publicación está a un paso', extend: '¿Te ayudamos a extender tu publicación?', promo: '¿Te ayudamos con tu pago?' };
const FIRST = {
  verified: (label) => `empezaste a agregar el sello **Verificado** a tu publicación (${label}) y el pago no se completó`,
  home: (label) => `empezaste a destacar tu publicación (${label}) en la **portada** de Casa Libre y el pago no se completó`,
  listing: (label) => `empezaste a pagar tu publicación (${label}) para publicarla y el pago no se completó. Quedó guardada con todo lo que cargaste`,
  extend: (label) => `empezaste a extender tu publicación (${label}) y el pago no se completó`,
  promo: (label) => `empezaste un pago para tu publicación (${label}) y no se completó`,
};
// c = one of newCheckouts(); → an action (kind unpaid_listing, plan) ready for the report
export function firstPayDraft(c, { listing, user, site }) {
  const name = firstName(user?.full_name || listing?.contact_name);
  const base = String(site).replace(/\/$/, '');
  const pid = c.property_id;
  const url = c.plan === 'verified' || c.plan === 'home' ? `${base}/cuenta/publicaciones?pay=${pid}&plan=${c.plan}`
    : c.plan === 'listing' ? `${base}/cuenta/publicaciones?pay_listing=${pid}`
    : c.plan === 'extend' ? `${base}/cuenta/publicaciones?extend=${pid}` : `${base}/cuenta/publicaciones`;
  const live = listing?.status === 'published' && (c.plan === 'verified' || c.plan === 'home');
  const where = listing?.neighborhood || listing?.city || '';
  return {
    kind: 'unpaid_listing',
    user_id: c.user_id,
    property_id: pid,
    plan: c.plan,
    followup: 0,
    reason: `Opened the ${PAY_LABEL[c.plan].replace('Waiting for payment: ', '')} checkout on ${String(c.started_at).slice(0, 10)} and did not pay.`,
    evidence: `Checkout started ${String(c.started_at).slice(0, 16).replace('T', ' ')} UTC${c.amount_usd != null ? `, US$${c.amount_usd}` : ''}; no payment since.`,
    subject: SUBJECT[c.plan],
    heading: `Tu ${lowerType(listing)}${where ? ` en ${where}` : ''}`,
    body: [
      `Hola${name ? ` ${name}` : ''},`,
      `Vimos que el ${fmtDate(c.started_at)} ${FIRST[c.plan](listingLabel(listing))}.`,
      `${live ? 'Tu publicación sigue activa y visible, así que no perdiste nada. ' : ''}${NEXT[c.plan]}`,
      `Si algo no funcionó con la tarjeta o tenés alguna duda, respondé este correo o escribinos desde [contacto](${base}/contacto) y te ayudamos.`,
      'Un abrazo,\nEl equipo de Casa Libre',
    ].join('\n\n'),
    button_label: BUTTON[c.plan],
    button_url: url,
  };
}
