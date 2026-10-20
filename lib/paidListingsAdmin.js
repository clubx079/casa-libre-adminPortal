// Paid listings — admin side (the buyer portal applies it: lib/paidListings.js,
// lib/listingQuota.js, lib/samePerson.js, lib/automations/paidListings.js there).
// The settings are the `automations` row 'paid_listings' (no table of its own):
//   enabled → paywall on · first_tier_count → free listings per month ·
//   free_days → days a paid listing stays live · later_free_days → days an extension adds ·
//   remind_days_before → "ends soon" email · milestones → [list price ¢, discount %,
//   extension price ¢, same-person signals needed] · template_id → "ends soon" email ·
//   reminder_template_id → "ended" email · gift_template_id → "plan for agents" email.
// Pure — test/paidListingsAdmin.test.js.

export const PAID_LISTINGS_ID = 'paid_listings';

export const DEFAULTS = Object.freeze({ enabled: false, freePerMonth: 3, listCents: 2900, discountPct: 80, days: 90, extendCents: 500, extendDays: 30, remindDaysBefore: 3, samePersonMin: 2 });

const int = (v, min, max, dflt) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : dflt; };

export function paidConfig(row) {
  if (!row) return { ...DEFAULTS, endingTemplateId: null, endedTemplateId: null, agentTemplateId: null, enabledAt: null };
  const m = Array.isArray(row.milestones) ? row.milestones : [];
  return {
    enabled: row.enabled === true, enabledAt: row.enabled_at || null,
    freePerMonth: int(row.first_tier_count, 0, 1000, DEFAULTS.freePerMonth),
    listCents: int(m[0], 0, 1000000, DEFAULTS.listCents), discountPct: int(m[1], 0, 100, DEFAULTS.discountPct),
    extendCents: int(m[2], 0, 1000000, DEFAULTS.extendCents), samePersonMin: int(m[3], 1, 3, DEFAULTS.samePersonMin),
    days: int(row.free_days, 1, 365, DEFAULTS.days), extendDays: int(row.later_free_days, 1, 365, DEFAULTS.extendDays),
    remindDaysBefore: int(row.remind_days_before, 1, 60, DEFAULTS.remindDaysBefore),
    endingTemplateId: row.template_id || null, endedTemplateId: row.reminder_template_id || null, agentTemplateId: row.gift_template_id || null,
  };
}

export const priceCents = (cfg) => Math.round((cfg.listCents * (100 - cfg.discountPct)) / 100);
export const usd = (cents) => { const v = Number(cents) / 100; return `US$${Number.isInteger(v) ? v : v.toFixed(2)}`; };

// "29" | "29.00" | 29 → 2900; anything else → NaN
const toCents = (v) => { const s = String(v ?? '').trim().replace(',', '.'); return /^\d+(\.\d{1,2})?$/.test(s) ? Math.round(Number(s) * 100) : NaN; };

// The page's form → the automations row fields. input uses the page's names:
// { enabled, freePerMonth, listPrice, discountPct, days, extendPrice, extendDays,
//   remindDaysBefore, samePersonMin, endingTemplateId, endedTemplateId, agentTemplateId }
export function validatePaidSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = paidConfig(currentRow);
  const errors = {};
  const num = (k, min, max, msg) => {
    if (input[k] === undefined) return cur[k];
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) { errors[k] = msg; return cur[k]; }
    return n;
  };
  const money = (k, curCents, msg) => {
    if (input[k] === undefined) return curCents;
    const c = toCents(input[k]);
    if (!Number.isFinite(c) || c < 50 || c > 1000000) { errors[k] = msg; return curCents; }
    return c;
  };
  const freePerMonth = num('freePerMonth', 0, 1000, 'A whole number from 0 to 1000.');
  const discountPct = num('discountPct', 0, 95, 'A whole number from 0 to 95.');
  const days = num('days', 1, 365, 'Between 1 and 365 days.');
  const extendDays = num('extendDays', 1, 365, 'Between 1 and 365 days.');
  const remindDaysBefore = num('remindDaysBefore', 1, 60, 'Between 1 and 60 days.');
  const samePersonMin = num('samePersonMin', 1, 3, 'Pick 1, 2 or 3.');
  const listCents = money('listPrice', cur.listCents, 'A price in US$ from 0.50, e.g. 29 or 29.00.');
  const extendCents = money('extendPrice', cur.extendCents, 'A price in US$ from 0.50, e.g. 5 or 4.99.');
  if (!errors.listPrice && !errors.discountPct && priceCents({ listCents, discountPct }) < 50) errors.discountPct = 'After the discount the price must be at least US$0.50 (card payments minimum).';
  if (!errors.remindDaysBefore && remindDaysBefore >= Math.min(days, extendDays)) errors.remindDaysBefore = `The "ends soon" email must come before the end (less than ${Math.min(days, extendDays)} days).`;

  const value = {
    first_tier_count: freePerMonth, free_days: days, later_free_days: extendDays, remind_days_before: remindDaysBefore,
    milestones: [listCents, discountPct, extendCents, samePersonMin],
  };
  for (const [k, col] of [['endingTemplateId', 'template_id'], ['endedTemplateId', 'reminder_template_id'], ['agentTemplateId', 'gift_template_id']]) {
    value[col] = input[k] !== undefined ? (input[k] || null) : (currentRow?.[col] ?? null);
  }
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  value.enabled = enabled;
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  // Each email is optional: no template = that email isn't sent (the listing still ends
  // on time). Sending by WhatsApp instead is the card's "Send by" row (migration 017).
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// The three emails, created on first save if missing (Spanish — edit them in Email templates).
export const DEFAULT_TEMPLATES = [
  {
    key: 'paid-listing-ending', col: 'template_id', name: 'Paid listing — ends soon',
    subject: 'Tu publicación termina en {{days_left}} días', heading: 'Tu publicación termina pronto',
    body: 'Hola {{name}},\n\nTu publicación **{{property_title}}** está en Casa Libre hasta el {{listing_until}}.\n\nSi todavía no la vendiste o alquilaste, extendela {{free_days}} días más por {{price}} y seguí recibiendo consultas.',
    button_label: 'Extender mi publicación', button_url: '{{extend_url}}',
  },
  {
    key: 'paid-listing-ended', col: 'reminder_template_id', name: 'Paid listing — ended',
    subject: 'Tu publicación terminó', heading: 'Tu publicación ya no está en el sitio',
    body: 'Hola {{name}},\n\nEl tiempo de tu publicación **{{property_title}}** terminó el {{listing_until}} y ya no aparece en Casa Libre.\n\nExtendela {{free_days}} días por {{price}} y vuelve a publicarse al instante.',
    button_label: 'Volver a publicar', button_url: '{{extend_url}}',
  },
  {
    key: 'agent-plan', col: 'gift_template_id', name: 'Plan for agents',
    subject: 'Un plan para agentes e inmobiliarias', heading: '¿Publicás muchas propiedades?',
    body: 'Hola {{name}},\n\nVimos que ya usaste tus {{free_limit}} publicaciones gratis de este mes. Si trabajás como agente o con una inmobiliaria, estamos preparando un plan para publicar más propiedades por mes.\n\nContanos qué necesitás y te avisamos primero.',
    button_label: 'Quiero saber más', button_url: '{{business_url}}',
  },
];

// Accounts that look like one person (same as the buyer portal's lib/samePerson.js):
// joined when two of their listings share `min`+ of device id, device profile, connection
// — or the same contact phone, or one's listing phone is another account's verified
// WhatsApp (`verified`: [{ id, phone }]). A seller's second account still carries their
// real number, so the phone is enough on its own.
const KEYS = ['device_id', 'fp', 'ip'];
const matchCount = (a = {}, b = {}) => KEYS.filter((k) => a?.[k] && b?.[k] && a[k] === b[k]).length;
export const PHONE_PREFIX = { py: '595', bo: '591', uy: '598', ve: '58', sv: '503' };
// Any phone string → E.164 (+595981…), like the buyer portal's lib/whatsappPhone.js.
export function toE164(input, prefix) {
  const raw = String(input ?? '').trim();
  let d = raw.replace(/\D/g, '');
  if (!d) return null;
  const ok = (x) => (x.length >= 8 && x.length <= 15 && !x.startsWith('0') ? `+${x}` : null);
  if (raw.startsWith('+')) return ok(d);
  if (d.startsWith('00')) return ok(d.slice(2));
  const p = String(prefix || '').replace(/\D/g, '');
  if (p && d.startsWith(p) && d.length - p.length >= 6) return ok(d);
  return ok(p + d.replace(/^0+/, ''));
}
export function samePersonGroups(listings = [], min = 2, { prefix = '', verified = [] } = {}) {
  const phoneOf = (p) => toE164(p?.contact_phone, prefix);
  const withSig = listings.filter((p) => p?.created_by && (p?.raw_data?.signals || p?.contact_phone));
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const p of withSig) if (!parent.has(String(p.created_by))) parent.set(String(p.created_by), String(p.created_by));
  const why = new Map();
  for (let i = 0; i < withSig.length; i++) {
    for (let j = i + 1; j < withSig.length; j++) {
      const a = withSig[i], b = withSig[j];
      if (String(a.created_by) === String(b.created_by)) continue;
      const pa = phoneOf(a);
      const samePhone = !!pa && pa === phoneOf(b);
      const sa = a.raw_data?.signals || {}, sb = b.raw_data?.signals || {};
      const sig = matchCount(sa, sb) >= min;
      if (!samePhone && !sig) continue;
      const ra = find(String(a.created_by)), rb = find(String(b.created_by));
      if (ra !== rb) parent.set(ra, rb);
      why.set([String(a.created_by), String(b.created_by)].sort().join('|'), [...(samePhone ? ['phone'] : []), ...(sig ? KEYS.filter((k) => sa[k] && sa[k] === sb[k]) : [])]);
    }
  }
  for (const p of withSig) {
    const ph = phoneOf(p);
    const v = ph && verified.find((x) => toE164(x?.phone, prefix) === ph && String(x.id) !== String(p.created_by));
    if (!v) continue;
    const a = String(p.created_by), b = String(v.id);
    if (!parent.has(b)) parent.set(b, b);
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
    why.set([a, b].sort().join('|'), ['phone']);
  }
  const groups = new Map();
  for (const id of parent.keys()) { const r = find(id); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(id); }
  return [...groups.values()].filter((g) => g.length > 1).map((users) => ({
    users: users.sort(),
    matched: [...new Set([...why.entries()].filter(([k]) => k.split('|').every((u) => users.includes(u))).flatMap(([, m]) => m))],
  }));
}
export const SIGNAL_LABEL = { phone: 'same phone number', device_id: 'same device', fp: 'same device profile', ip: 'same connection (Wi-Fi / network)' };

// Numbers for the page. payments = listing payments + free-ledger rows; props = user listings.
export function paidStats({ payments = [], props = [], monthStart }) {
  const ok = payments.filter((p) => p.status === 'succeeded');
  const sum = (rows) => Math.round(rows.reduce((s, r) => s + (Number(r.amount_usd) || 0), 0) * 100) / 100;
  const inMonth = (r) => !monthStart || String(r.created_at) >= monthStart;
  return {
    freeThisMonth: payments.filter((p) => p.kind === 'listing_free' && inMonth(p)).length,
    paidThisMonth: ok.filter((p) => p.kind === 'listing' && inMonth(p)).length,
    extendedThisMonth: ok.filter((p) => p.kind === 'listing_extend' && inMonth(p)).length,
    revenueThisMonth: sum(ok.filter((p) => (p.kind === 'listing' || p.kind === 'listing_extend') && inMonth(p))),
    revenueAllTime: sum(ok.filter((p) => p.kind === 'listing' || p.kind === 'listing_extend')),
    pending: props.filter((p) => p.status === 'payment_pending').length,
    activePaid: props.filter((p) => p.raw_data?.paid_listing?.state === 'active').length,
    ended: props.filter((p) => p.status === 'expired').length,
  };
}
