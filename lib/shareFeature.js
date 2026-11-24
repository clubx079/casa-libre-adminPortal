// "New: share your listing" ANNOUNCEMENT — an email that tells members about the share
// feature (WhatsApp, Instagram, Gmail, X or a copied link → more visits; 3 steps; the demo
// video), sent again every N hours. The pure rules, shared word-for-word with the admin
// portal (lib/shareFeature.js there is an identical copy). The website sends
// (lib/automations/shareFeature.js, hourly cron); the admin configures it (Automations page →
// "Share feature announcement").
//
// Settings: the `automations` row 'share_feature_promo' (one per country DB) — enabled /
// enabled_at, template_id (the email) and free_tiers[0] = { firstAfterHours, everyHours,
// maxSends, perRun }. No table of its own. Off until an admin switches it on.
//
// Schedule, per person (a verified account — buyers and sellers):
//   1st email  at the first daytime run after it is switched on (accounts that existed then),
//              or firstAfterHours after sign-up (accounts made later; default 24 h)
//   then       every everyHours hours after the previous one (default 48)
//   up to      maxSends emails per person; 0 = no limit (the default: "continuously")
//   never      test / team accounts · closed, blocked, suspended or deleted accounts ·
//              people who opted out (WhatsApp BAJA, or a referral-promo opt-out) · whose
//              email bounced or was marked as spam (this automation's or the referral
//              promo's stop records)
// Sends: email_log rows, dedupe key sharefeature:<user id>:<n> (n = 1, 2, 3 …), run_id = the
// user — the number of sends is the number of distinct n, so a retry never sends twice.
// A bounce / complaint found before a repeat is remembered as an event row with dedupe key
// sharefeature-stop:<user id>:ev (channel 'event', which every email count skips).

export const SHARE_FEATURE_ID = 'share_feature_promo';
export const SHARE_FEATURE_TEMPLATE_KEY = 'share-feature-promo';
export const SHARE_FEATURE_DEMO_URL = 'https://www.youtube.com/watch?v=FcI87hgYEMY';
const HOUR = 3600e3;

export const SHARE_FEATURE_DEFAULTS = Object.freeze({ firstAfterHours: 24, everyHours: 48, maxSends: 0, perRun: 100 });
export const SHARE_FEATURE_RANGES = Object.freeze({ firstAfterHours: [0, 720], everyHours: [1, 2160], maxSends: [0, 100], perRun: [1, 1000] });

const int = (v, [min, max], d) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= min && n <= max ? n : d; };

// automations row → the settings, every gap filled from SHARE_FEATURE_DEFAULTS.
export function shareFeatureConfig(row) {
  const s = (Array.isArray(row?.free_tiers) ? row.free_tiers[0] : row?.free_tiers) || {};
  const pick = (k) => int(s[k], SHARE_FEATURE_RANGES[k], SHARE_FEATURE_DEFAULTS[k]);
  return {
    exists: !!row,
    enabled: row?.enabled === true && !!row?.enabled_at,
    enabledAt: row?.enabled_at || null,
    templateId: row?.template_id || null,
    firstAfterHours: pick('firstAfterHours'),
    everyHours: pick('everyHours'),
    maxSends: pick('maxSends'),
    perRun: pick('perRun'),
  };
}

// ── Keys ─────────────────────────────────────────────────────────────────────────────
export const shareFeatureKey = (userId, n) => `sharefeature:${userId}:${n}`;
export const shareFeatureStopKey = (userId) => `sharefeature-stop:${userId}:ev`;
export const SHARE_FEATURE_STEP_KEY = /^sharefeature:([^:]+):(\d+)$/;
// stop records that also stop this email: ours + the referral promo's (same people, same inbox)
const STOP_PREFIXES = ['sharefeature-stop:', 'refpromo-stop:'];

// email_log rows (this automation's + the referral promo's stop rows) → Map user id →
// { sent, lastAtMs, lastResendId, stop }
//   sent = how many different emails (n) went out · lastAtMs = when the latest went out
//   stop = the reason recorded in a stop event row ('unsubscribed' | 'bounced' | 'complained')
export function shareFeatureProgress(logs = []) {
  const by = new Map();
  const get = (id) => by.get(id) || by.set(id, { steps: new Set(), sent: 0, lastAtMs: 0, lastResendId: null, lastN: 0, stop: null }).get(id);
  for (const l of logs) {
    const key = String(l?.dedupe_key || '');
    if (STOP_PREFIXES.some((p) => key.startsWith(p))) { get(String(l.run_id)).stop = l.subject || 'unsubscribed'; continue; }
    const m = SHARE_FEATURE_STEP_KEY.exec(key);
    if (!m) continue;
    if (['failed', 'test'].includes(l.status)) continue;
    const p = get(m[1]);
    const n = Number(m[2]);
    p.steps.add(n);
    const at = Date.parse(l.created_at) || 0;
    if (at > p.lastAtMs) p.lastAtMs = at;
    if (n >= p.lastN) { p.lastN = n; p.lastResendId = l.resend_id || p.lastResendId; }
  }
  for (const p of by.values()) p.sent = p.steps.size;
  return by;
}

// The next email for one person (pure).
//   → { state: 'done' | 'excluded' | 'waiting' | 'due', n, dueAtMs, existing }
//   n = the number of the email that goes next (1-based)
export function shareFeatureNext({ createdAtMs, sent = 0, lastAtMs = 0 }, cfg, nowMs) {
  const enabledAtMs = Date.parse(cfg?.enabledAt || '') || 0;
  const existing = Number.isFinite(createdAtMs) && enabledAtMs > 0 && createdAtMs < enabledAtMs;
  if (cfg.maxSends > 0 && sent >= cfg.maxSends) return { state: 'done', n: sent, dueAtMs: null, existing };
  if (sent === 0 && !Number.isFinite(createdAtMs)) return { state: 'excluded', n: 1, dueAtMs: null, existing };
  const dueAtMs = sent === 0
    ? (existing ? enabledAtMs : createdAtMs + cfg.firstAfterHours * HOUR)
    : lastAtMs + cfg.everyHours * HOUR;
  return { state: nowMs >= dueAtMs ? 'due' : 'waiting', n: sent + 1, dueAtMs, existing };
}

// "every 48 hours" / "every 2 days"
export function everyText(h) {
  return h % 24 === 0 && h >= 48 ? `every ${h / 24} days` : h === 24 ? 'every day' : `every ${h} ${h === 1 ? 'hour' : 'hours'}`;
}
// Plain-language schedule for the admin: "right away, then every 48 hours · no limit"
export function shareFeatureScheduleText(cfg) {
  const times = cfg.maxSends === 0 ? 'no limit' : `up to ${cfg.maxSends} ${cfg.maxSends === 1 ? 'email' : 'emails'} per person`;
  if (cfg.maxSends === 1) return 'one email per person';
  return `first email at the next daytime run, then ${everyText(cfg.everyHours)} · ${times}`;
}

// The email, created by the admin's first save or migrations/027_share_feature_promo.sql
// (Spanish, voseo — edit it in Templates). ">>" = the inbox preview line; [[…]](…) = the
// outlined "Ver la demo" button; the main button opens Mis publicaciones with UTM tags
// (shareFeatureListingsUrl).
// No opt-out line (the user's rule).
export const SHARE_FEATURE_TEMPLATE = Object.freeze({
  key: SHARE_FEATURE_TEMPLATE_KEY,
  name: 'Compartir — anuncio de la nueva función',
  subject: 'Nuevo en Casa-Libre: compartí tu propiedad y sumá más visitas',
  heading: 'Compartí tu propiedad y llegá a más interesados',
  body: '>> WhatsApp, Instagram, Gmail, X o un link: tu propiedad llega a más personas en un toque. Mirá la demo.\n'
    + 'Hola {{name}},\n\n'
    + 'Ahora podés compartir tu propiedad de Casa-Libre en WhatsApp, Instagram, Gmail o X, o copiar su link, en un solo toque. Compartirla es la forma más rápida de sumar visitas: cada persona que abre tu link ve tu propiedad, y los compradores o inquilinos interesados te escriben directo a tu WhatsApp.\n\n'
    + 'Funciona en la web y en la app de Casa-Libre para iPhone y Android. Mirá la demo aquí:\n\n'
    + `[[Ver la demo]](${SHARE_FEATURE_DEMO_URL})`,
  button_label: 'Compartir mi propiedad',
  button_url: '{{my_listings_url}}',
});

// The main button's link: Mis publicaciones with this email's own UTM tags (the send passes it as
// {{my_listings_url}}; a link that already has utm_source keeps its tags). The admin's template
// editor only takes a bare link variable as the button link, so the tags live here.
export const SHARE_FEATURE_UTM = 'utm_source=email&utm_medium=automation&utm_campaign=share_feature&utm_content=share-feature-promo';
export const shareFeatureListingsUrl = (siteUrl) => `${String(siteUrl || '').replace(/\/$/, '')}/cuenta/publicaciones?${SHARE_FEATURE_UTM}`;
