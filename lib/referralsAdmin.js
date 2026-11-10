// Referral program — admin side. The website runs it (casa-libre-buyerPortal
// lib/referrals/: the /ref/<code> link, sign-up attribution, the hourly engine that
// qualifies referrals, grants the rewards as promotions and sends the emails). This page
// sets it up per country and shows every link, person and reward.
// Settings: the `automations` row 'referrals' (enabled + free_tiers[0]); records: email_log
// event rows (lib/referrals/store.js). Pure — test/referralsAdmin.test.js.
import { referralConfig, DEFAULTS, PLANS, TEMPLATE_KEYS, dataOf, isLive, maskName } from './referrals/core.js';

export { REFERRALS_ID, TEMPLATE_KEYS } from './referrals/core.js';

const int = (v, min, max) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : NaN; };

// The page's form → the automations row. Every field is optional (missing = keep).
// → { ok, value: { enabled, enabled_at?, free_tiers }, errors }
export function validateReferralSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = referralConfig(currentRow);
  const errors = {};
  const num = (path, v, min, max, fallback, msg) => {
    if (v === undefined) return fallback;
    const n = int(v, min, max);
    if (Number.isNaN(n)) { errors[path] = msg; return fallback; }
    return n;
  };
  const reward = (key, src = {}) => {
    const c = cur[key];
    const plan = src.plan === undefined ? c.plan : src.plan;
    if (!PLANS.includes(plan)) errors[`${key}.plan`] = 'Pick Verified or Verified + home page.';
    return {
      enabled: src.enabled === undefined ? c.enabled : !!src.enabled,
      plan: PLANS.includes(plan) ? plan : c.plan,
      days: num(`${key}.days`, src.days, 1, 365, c.days, 'Between 1 and 365 days.'),
    };
  };
  const ms = input.milestone || {};
  let remindDays = cur.remindDays;
  if (input.remindDays !== undefined) {
    const list = (Array.isArray(input.remindDays) ? input.remindDays : String(input.remindDays).split(/[,\s]+/)).filter((x) => String(x).trim() !== '').map(Number);
    if (list.some((n) => !Number.isInteger(n) || n < 1 || n > 60) || list.length > 5) errors.remindDays = 'Up to 5 whole numbers of days, each 1 to 60 (e.g. 3, 1).';
    else remindDays = [...new Set(list)].sort((a, b) => b - a);
  }
  const settings = {
    attributionDays: num('attributionDays', input.attributionDays, 1, 365, cur.attributionDays, 'Between 1 and 365 days.'),
    referrer: reward('referrer', input.referrer),
    newUser: reward('newUser', input.newUser),
    milestone: {
      ...reward('milestone', ms),
      every: num('milestone.every', ms.every, 1, 100, cur.milestone.every, 'A whole number from 1 to 100.'),
      repeat: ms.repeat === undefined ? cur.milestone.repeat : !!ms.repeat,
    },
    remindDays,
    maxRewardsPerReferrer: num('maxRewardsPerReferrer', input.maxRewardsPerReferrer, 0, 10000, cur.maxRewardsPerReferrer, '0 (no limit) or a whole number.'),
    requireReferrerListing: input.requireReferrerListing === undefined ? cur.requireReferrerListing : !!input.requireReferrerListing,
    inviteChannel: input.inviteChannel === undefined ? cur.inviteChannel : input.inviteChannel,
    inviteWaTemplate: input.inviteWaTemplate === undefined ? cur.inviteWaTemplate : String(input.inviteWaTemplate || '').trim(),
    shareText: input.shareText === undefined ? cur.shareText : String(input.shareText || '').trim(),
  };
  if (!['email', 'whatsapp', 'both'].includes(settings.inviteChannel)) errors.inviteChannel = 'Email, WhatsApp or both.';
  if (settings.inviteWaTemplate && !/^[a-z0-9_]{3,80}$/.test(settings.inviteWaTemplate)) errors.inviteWaTemplate = 'A Relay template name: lowercase letters, digits and _ only.';
  if (settings.inviteChannel !== 'email' && !settings.inviteWaTemplate) errors.inviteWaTemplate = 'WhatsApp needs an approved template name.';
  if (!settings.shareText) errors.shareText = 'Write the message people share.';
  else if (!settings.shareText.includes('{{link}}')) errors.shareText = 'The message must include {{link}} (where the person’s link goes).';
  else if (settings.shareText.length > 600) errors.shareText = 'Keep it under 600 characters.';
  if (!errors.remindDays && remindDays.some((d) => d >= Math.min(settings.referrer.days, settings.newUser.days, settings.milestone.days))) {
    errors.remindDays = 'Reminders must come before the reward ends (fewer days than the shortest reward).';
  }
  const enabled = input.enabled === undefined ? cur.enabled : !!input.enabled;
  const value = { enabled, free_tiers: [settings], updated_at: nowIso };
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// The emails, created on the first save if missing (Spanish, voseo — edit them in Templates).
// Copy follows the Casa-Libre marketing formula: benefit + brand first, what it is, the offer,
// one checkable fact, one action (no opt-out line: these go to people with an account).
export const DEFAULT_TEMPLATES = [
  {
    key: TEMPLATE_KEYS.invite, name: 'Referrals — invite',
    subject: '{{name}}, ganá días de publicación Verificada gratis en Casa-Libre',
    heading: 'Invitá a alguien a publicar y ganá {{reward_days}} días de publicación Verificada gratis y aparición en la portada',
    body: 'Hola {{name}},\n\nCompartí tu link de Casa-Libre con quien quiera vender o alquilar su propiedad. En Casa-Libre los interesados escriben directo al WhatsApp del dueño y no cobramos comisión.\n\nPor cada persona que se registre con tu link y publique una propiedad:\n**Vos** recibís {{reward_days}} días de publicación Verificada gratis.\n**La persona** recibe {{new_user_days}} días Verificada en su publicación.\nCon **{{milestone_count}} invitados** que publiquen, una de tus propiedades sale además en la portada durante {{milestone_days}} días.\n\nTu link: [{{referral_url}}]({{referral_url}})',
    button_label: 'Ver mi link', button_url: '{{referrals_url}}',
  },
  {
    key: TEMPLATE_KEYS.referrer, name: 'Referrals — referrer reward',
    subject: '{{referred_name}} publicó con tu link: ganaste días Verificada en Casa-Libre',
    heading: 'Ganaste {{free_days}} días Verificada',
    body: 'Hola {{name}},\n\n{{referred_name}} se registró con tu link y publicó su propiedad. Como agradecimiento, **{{property_title}}** tiene {{reward_plan}} gratis hasta el **{{free_until}}**.\n\nLlevás {{referral_count}} invitados que publicaron. Seguí compartiendo tu link para sumar más días.',
    button_label: 'Ver mis referidos', button_url: '{{referrals_url}}',
  },
  {
    key: TEMPLATE_KEYS.newUser, name: 'Referrals — new member reward',
    subject: '{{name}}, tu publicación está Verificada gratis en Casa-Libre',
    heading: 'Tu publicación está Verificada',
    body: 'Hola {{name}},\n\nTe registraste en Casa-Libre con la invitación de {{referrer_name}}. Por eso **{{property_title}}** tiene {{reward_plan}} gratis durante {{free_days}} días, hasta el **{{free_until}}**.\n\nLa insignia Verificada ayuda a que los interesados confíen en tu publicación. Vos también podés invitar a otros desde tu cuenta y ganar más días.',
    button_label: 'Ver mi publicación', button_url: '{{property_url}}',
  },
  {
    key: TEMPLATE_KEYS.milestone, name: 'Referrals — home-page reward',
    subject: '{{referral_count}} invitados publicaron: tu propiedad está en la portada de Casa-Libre',
    heading: 'Tu propiedad está en la portada',
    body: 'Hola {{name}},\n\nYa son {{referral_count}} las personas que publicaron con tu link. Como premio, **{{property_title}}** tiene {{reward_plan}} gratis hasta el **{{free_until}}**.',
    button_label: 'Ver mi propiedad', button_url: '{{property_url}}',
  },
  {
    key: TEMPLATE_KEYS.ending, name: 'Referrals — reward ends soon',
    subject: 'Tu premio en Casa-Libre termina el {{free_until}}',
    heading: 'Quedan {{days_left}} días',
    body: 'Hola {{name}},\n\nLos días gratis de Casa-Libre para **{{property_title}}** terminan el **{{free_until}}**. Desde ese día deja de tener {{reward_plan}}.\n\nSi querés mantenerlo, extendelo 30 días por {{price}}. Los días se suman al final del período gratis.\n\nTambién podés seguir invitando: cada persona que publique con tu link te suma {{reward_days}} días.',
    button_label: 'Extender por {{price}}', button_url: '{{extend_url}}',
  },
];

// "Verified users" for the invite: an account that proved its email or WhatsApp
// (users.verified), is active, not blocked or suspended, not deleted, not the team's own.
// With requireReferrerListing, only people with a live listing. → users
export function inviteAudience(users = [], { isInternal = () => false, liveOwners = new Set(), requireListing = false } = {}) {
  return users.filter((u) => u?.verified === true && u.active !== false && !u.blocked && !u.suspended && u.email
    && !isInternal(u.email) && (!requireListing || liveOwners.has(String(u.id))));
}

// Proof line: live listings rounded down ("3.600"; under 100 → exact).
export function roundDownProof(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  const r = v >= 1000 ? Math.floor(v / 100) * 100 : v >= 100 ? Math.floor(v / 10) * 10 : v;
  return r.toLocaleString('es-PY').replace(/,/g, '.');
}

// One row per referrer: link, clicks, sign-ups, listed (qualified), rejected, rewards.
// codes/clicks/persons/rewards are email_log rows (lib/referrals/store.js); users by id.
export function referrerRows({ codes = [], clicks = [], persons = [], rewards = [], users = new Map(), site = '' } = {}) {
  const by = new Map();
  const row = (uid) => {
    const k = String(uid);
    if (!by.has(k)) by.set(k, { userId: k, code: null, clicks: 0, signups: 0, waiting: 0, qualified: 0, rejected: 0, granted: 0, pending: 0, last: null });
    return by.get(k);
  };
  const touch = (r, at) => { if (at && (!r.last || at > r.last)) r.last = at; };
  for (const c of codes) { const r = row(c.run_id); r.code = c.subject; touch(r, c.created_at); }
  for (const c of clicks) { const r = row(c.run_id); r.clicks++; touch(r, c.created_at); }
  for (const p of persons) {
    const r = row(p.run_id); r.signups++; touch(r, p.created_at);
    if (p.subject === 'qualified') r.qualified++; else if (p.subject === 'rejected') r.rejected++; else r.waiting++;
  }
  for (const w of rewards) {
    if (dataOf(w).type === 'new_user') continue;      // the new person's own reward isn't the referrer's
    const r = row(w.run_id);
    if (w.subject === 'granted' || w.subject === 'expired') r.granted++; else if (w.subject === 'pending') r.pending++;
  }
  return [...by.values()].map((r) => {
    const u = users.get(r.userId) || {};
    return { ...r, name: u.full_name || null, email: u.email || null, link: r.code ? `${String(site).replace(/\/$/, '')}/ref/${r.code}` : null };
  }).sort((a, b) => (b.qualified - a.qualified) || (b.signups - a.signups) || (b.clicks - a.clicks) || String(b.last || '').localeCompare(String(a.last || '')));
}

// Who referred whom (admin sees full names + emails; the website shows them masked).
export function personRows(persons = [], users = new Map(), listings = new Map()) {
  return persons.map((p) => {
    const d = dataOf(p);
    const referred = users.get(String(d.referred_id)) || {};
    const referrer = users.get(String(p.run_id)) || {};
    const own = listings.get(String(d.referred_id)) || [];
    return {
      id: p.id, state: p.subject, hold: d.hold || null, reason: d.reason || null, matched: d.matched || null, override: !!d.override,
      joinedAt: d.signed_up_at || p.created_at, clickedAt: d.clicked_at || null, qualifiedAt: d.qualified_at || null, method: d.method || null, code: d.code || null,
      listingId: d.listing_id || (own.find(isLive) || own[0] || {}).id || null,
      referred: { id: d.referred_id, name: referred.full_name || d.referred_name || null, email: referred.email || p.to_email || null, masked: maskName(referred.full_name || d.referred_name, referred.email || p.to_email) },
      referrer: { id: String(p.run_id), name: referrer.full_name || null, email: referrer.email || null },
    };
  });
}

export function rewardRows(rewards = [], users = new Map(), props = new Map()) {
  return rewards.map((r) => {
    const d = dataOf(r);
    const u = users.get(String(r.run_id)) || {};
    const p = d.property_id ? props.get(String(d.property_id)) : null;
    return {
      id: r.id, state: r.subject, type: d.type || 'manual', plan: d.plan_applied || d.plan, days: d.days, until: d.until || null, grantedAt: d.granted_at || null,
      wait: d.wait || null, lastError: d.last_error || null, emailed: d.emailed || false, reminded: d.reminded || [], note: d.note || null,
      createdAt: d.created_at || r.created_at, step: d.step || null, referredName: d.referred_name || null,
      user: { id: String(r.run_id), name: u.full_name || null, email: u.email || r.to_email || null },
      listing: p ? { id: p.id, title: [p.property_type, p.neighborhood || p.city].filter(Boolean).join(' · ') } : (d.property_id ? { id: d.property_id, title: null } : null),
    };
  });
}

export { STATE_LABEL, HOLD_LABEL, REASON_LABEL, TYPE_LABEL, PLAN_LABEL } from './referralsLabels.js';
export { DEFAULTS };
