// Referral program PROMO — "invite someone to publish and earn the Verified badge for free":
// emails that tell members about the referral program, with their own link. The pure
// rules, shared word-for-word with the admin portal (lib/referrals/promo.js there is an
// identical copy). The website sends (lib/automations/referralPromo.js, hourly cron); the
// admin configures it (Automations page).
//
// Settings: the `automations` row 'referral_promo' (one per country DB) — enabled /
// enabled_at, template_id (the email) and free_tiers[0] = { firstAfterHours, everyDays,
// maxSends, includeExisting, perRun }. No table of its own. Off until an admin switches it
// on, and it only sends while the referral program itself ('referrals' row) is on.
//
// Schedule, per person (a verified account):
//   1st email  firstAfterHours after they signed up (default 24 h)
//   then       every everyDays days after the previous one (default 7), up to maxSends (3)
//   existing   people who signed up before it was switched on enter the same schedule when
//              includeExisting is on (their 1st email at the next run), else never
//   stop early they referred someone who signed up · unsubscribed (the link in the email,
//              or replied BAJA on WhatsApp) · account closed/deleted · the email bounced or
//              was marked as spam
// Sends: email_log rows, dedupe key refpromo:<user id>:<n> (n = 1, 2, 3 …), run_id = the
// user — the number of sends is the number of distinct n, so a retry never sends twice.
// Stops that need remembering (unsubscribe, bounce, complaint): an event row with
// dedupe key refpromo-stop:<user id>:ev (channel 'event', which every email count skips).

export const PROMO_ID = 'referral_promo';
export const PROMO_TEMPLATE_KEY = 'referral-promo';
const HOUR = 3600e3;
const DAYMS = 24 * HOUR;

export const PROMO_DEFAULTS = Object.freeze({ firstAfterHours: 24, everyDays: 7, maxSends: 3, includeExisting: true, perRun: 100 });
export const PROMO_RANGES = Object.freeze({ firstAfterHours: [1, 720], everyDays: [1, 60], maxSends: [1, 10], perRun: [1, 1000] });

const int = (v, [min, max], d) => { const n = Number(v); return Number.isInteger(n) && n >= min && n <= max ? n : d; };

// automations row → the settings, every gap filled from PROMO_DEFAULTS.
export function promoConfig(row) {
  const s = (Array.isArray(row?.free_tiers) ? row.free_tiers[0] : row?.free_tiers) || {};
  return {
    exists: !!row,
    enabled: row?.enabled === true && !!row?.enabled_at,
    enabledAt: row?.enabled_at || null,
    templateId: row?.template_id || null,
    firstAfterHours: int(s.firstAfterHours, PROMO_RANGES.firstAfterHours, PROMO_DEFAULTS.firstAfterHours),
    everyDays: int(s.everyDays, PROMO_RANGES.everyDays, PROMO_DEFAULTS.everyDays),
    maxSends: int(s.maxSends, PROMO_RANGES.maxSends, PROMO_DEFAULTS.maxSends),
    includeExisting: typeof s.includeExisting === 'boolean' ? s.includeExisting : PROMO_DEFAULTS.includeExisting,
    perRun: int(s.perRun, PROMO_RANGES.perRun, PROMO_DEFAULTS.perRun),
  };
}

// ── Keys ─────────────────────────────────────────────────────────────────────────────
export const promoKey = (userId, n) => `refpromo:${userId}:${n}`;
export const promoStopKey = (userId) => `refpromo-stop:${userId}:ev`;
export const PROMO_STOP_PURPOSE = 'refpromo_stop';   // the signed token of the email's "stop these emails" link
export const PROMO_STEP_KEY = /^refpromo:([^:]+):(\d+)(?::wa)?$/;   // ':wa' = the WhatsApp send of that step
export const STOP_REASONS = ['unsubscribed', 'bounced', 'complained'];

// email_log rows of this automation → Map user id → { sent, lastAtMs, lastResendId, stop }
//   sent = how many different emails (n) went out · lastAtMs = when the latest went out
//   stop = the reason recorded in a refpromo-stop event row, if any
export function promoProgress(logs = []) {
  const by = new Map();
  const get = (id) => by.get(id) || by.set(id, { steps: new Set(), sent: 0, lastAtMs: 0, lastResendId: null, lastN: 0, stop: null }).get(id);
  for (const l of logs) {
    const key = String(l?.dedupe_key || '');
    if (key.startsWith('refpromo-stop:')) { get(String(l.run_id)).stop = l.subject || 'unsubscribed'; continue; }
    const m = PROMO_STEP_KEY.exec(key);
    if (!m) continue;
    if (['failed', 'test'].includes(l.status)) continue;
    const p = get(m[1]);
    const n = Number(m[2]);
    p.steps.add(n);
    const at = Date.parse(l.created_at) || 0;
    if (at > p.lastAtMs) p.lastAtMs = at;
    // the latest EMAIL of the latest step: the one whose bounce / complaint is checked
    if (l.channel !== 'whatsapp' && !key.endsWith(':wa') && n >= p.lastN) { p.lastN = n; p.lastResendId = l.resend_id || p.lastResendId; }
  }
  for (const p of by.values()) p.sent = p.steps.size;
  return by;
}

// The next email for one person (pure).
//   → { state: 'done' | 'excluded' | 'waiting' | 'due', n, dueAtMs, existing }
//   n = the number of the email that goes next (1-based)
export function promoNext({ createdAtMs, sent = 0, lastAtMs = 0 }, cfg, nowMs) {
  const enabledAtMs = Date.parse(cfg?.enabledAt || '') || 0;
  const existing = Number.isFinite(createdAtMs) && enabledAtMs > 0 && createdAtMs < enabledAtMs;
  if (sent >= cfg.maxSends) return { state: 'done', n: sent, dueAtMs: null, existing };
  if (sent === 0 && existing && !cfg.includeExisting) return { state: 'excluded', n: 1, dueAtMs: null, existing };
  if (sent === 0 && !Number.isFinite(createdAtMs)) return { state: 'excluded', n: 1, dueAtMs: null, existing };
  const dueAtMs = sent === 0 ? createdAtMs + cfg.firstAfterHours * HOUR : lastAtMs + cfg.everyDays * DAYMS;
  return { state: nowMs >= dueAtMs ? 'due' : 'waiting', n: sent + 1, dueAtMs, existing };
}

// Plain-language schedule for the admin pages: "24 hours after sign-up, then every 7 days · up to 3 emails"
export function promoScheduleText(cfg) {
  const h = cfg.firstAfterHours;
  const first = h % 24 === 0 ? `${h / 24} ${h === 24 ? 'day' : 'days'}` : `${h} ${h === 1 ? 'hour' : 'hours'}`;
  if (cfg.maxSends === 1) return `one email ${first} after sign-up`;
  return `${first} after sign-up, then every ${cfg.everyDays} ${cfg.everyDays === 1 ? 'day' : 'days'} · up to ${cfg.maxSends} emails`;
}

// The email, created by the admin's first save or scripts/seed-referral-promo.mjs (Spanish,
// voseo — edit it in Templates). Roland's Marketing Formula: Hook (benefit + Casa-Libre in the
// subject/heading) · Claim · Offer (the real reward settings, as variables) · Proof (live
// listings, rounded down) · Action (their link + the button) · Opt-out.
export const PROMO_TEMPLATE = Object.freeze({
  key: PROMO_TEMPLATE_KEY,
  name: 'Referrals — promo after sign-up',
  subject: 'Invitá a alguien a publicar en Casa-Libre y ganá {{reward_plan}} gratis',
  heading: 'Ganá {{reward_plan}} por cada persona que invites',
  body: 'Hola {{name}},\n\n'
    + 'Casa-Libre es el marketplace inmobiliario donde los interesados escriben directo al WhatsApp del dueño y no cobramos comisión. Ahora también podés ganar promoción gratis invitando a otros a publicar.\n\n'
    + 'Compartí tu link con quien quiera vender o alquilar una propiedad. Cuando se registre con tu link y publique:\n'
    + '**Vos** ganás {{reward_plan}} gratis durante {{reward_days}} días en una de tus propiedades.\n'
    + '**La persona** recibe {{new_user_days}} días de publicación Verificada gratis.\n'
    + 'Con **{{milestone_count}} invitados** que publiquen, una de tus propiedades sale además en la portada durante {{milestone_days}} días.\n\n'
    + '¿Todavía no publicaste? Los días que ganes te esperan hasta que publiques tu primera propiedad.\n\n'
    + 'Tu link: [{{referral_url}}]({{referral_url}})\n\n'
    + 'Para no recibir más estos correos, [tocá acá]({{unsubscribe_url}}).',
  button_label: 'Compartir mi link',
  button_url: '{{referrals_url}}',
});

// Proof line: live listings rounded down ("3.600"; under 100 → exact). Same as the admin's.
export function roundDownProof(n) {
  const v = Math.max(0, Math.floor(Number(n) || 0));
  const r = v >= 1000 ? Math.floor(v / 100) * 100 : v >= 100 ? Math.floor(v / 10) * 10 : v;
  return String(r).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
