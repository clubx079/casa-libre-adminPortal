// The agency offer by portfolio size (Roland, Nov 5 2026 — "Casa-Libre Agency Offer" brief), and
// the same offer for developers by the number of units in their project (user, Nov 6 2026).
// An agency taps CARTERA → the website asks how many properties they have and where they publish
// them (website lib/waKeywords.js carteraReply); a developer taps PROYECTO → it asks the project's
// name, place and number of units (proyectoReply). Their answer reaches the Inbox assistant
// (lib/inboxAuto.js), which writes the offer for that size (rules in lib/aiPrompt.js) and returns
// the count it read ("portfolio"). This file decides what the count means — the tier, whether a
// person must take over, the alert note and the line saved on the lead. Pure —
// test/agencyOffer.test.js.
//   1–10      self-serve: the free listings each month, then the extra-listing price (send)
//   11–200    we migrate (agency) / load (developer) up to 100 free for 6 months, a person
//             coordinates (send + alert + email)
//   200+      custom offer, a person coordinates (send + alert + email)
export const MIGRATE_MIN = 11;
export const CUSTOM_ABOVE = 200;
export const FREE_MIGRATED = 100;
export const FREE_MONTHS = 6;

// the count the assistant read → a whole number of properties, or 0 when none was stated
export const portfolioCount = (v) => {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n > 0 && n < 100000 ? n : 0;
};

// → 'self' | 'migrate' | 'custom' | null
export function tierOf(count) {
  const n = portfolioCount(count);
  if (!n) return null;
  if (n < MIGRATE_MIN) return 'self';
  return n > CUSTOM_ABOVE ? 'custom' : 'migrate';
}

// a person takes over: the migration (11–200) or a custom offer (200+)
export const needsPerson = (count) => ['migrate', 'custom'].includes(tierOf(count));

// kind: 'agency' (tapped CARTERA: properties in the portfolio) | 'developer' (tapped PROYECTO:
// units in the project, same tiers)
export const KIND = {
  agency: { title: 'Agency portfolio', unit: 'listings', act: 'migrate', work: 'the migration', ask: 'their website / portal link or Excel' },
  developer: { title: 'Developer project', unit: 'units', act: 'load', work: 'loading the project', ask: "the project's brochure, price list (Excel) or web page" },
};
const kindOf = (k) => KIND[k] || KIND.agency;

export const tierLabel = (tier, kind = 'agency') => {
  const k = kindOf(kind);
  return {
    self: `1–10 ${k.unit}: self-serve`,
    migrate: `11–${CUSTOM_ABOVE} ${k.unit}: we ${k.act} up to ${FREE_MIGRATED} free for ${FREE_MONTHS} months`,
    custom: `${CUSTOM_ABOVE}+ ${k.unit}: custom offer`,
  }[tier] || '';
};
export const TIER_LABEL = { self: tierLabel('self'), migrate: tierLabel('migrate'), custom: tierLabel('custom') };

// the Alerts card / hand-over note
export const portfolioNote = (count, kind = 'agency') => {
  const n = portfolioCount(count);
  const tier = tierOf(n);
  if (!tier) return '';
  const k = kindOf(kind);
  const what = tier === 'self'
    ? 'The assistant sent the self-serve offer.'
    : `The assistant sent the offer; a person coordinates ${k.work} — ask for ${k.ask} if they have not shared it.`;
  return `${k.title}: ${n} ${k.unit} (${tierLabel(tier, kind)}). ${what}`;
};

// the line saved on their lead (potential_leads.notes) — one per lead, the newest count replaces it
const NOTE_RE = /\s*(?:·\s*)?(?:Portfolio: \d+ listings|Project: \d+ units) \(WhatsApp, \d{4}-\d{2}-\d{2}\)/g;
export function leadNotes(notes, count, now = new Date(), kind = 'agency') {
  const n = portfolioCount(count);
  const base = String(notes || '').replace(NOTE_RE, '').trim();
  if (!n) return base || null;
  const what = kind === 'developer' ? `Project: ${n} units` : `Portfolio: ${n} listings`;
  const line = `${what} (WhatsApp, ${new Date(now).toISOString().slice(0, 10)})`;
  return base ? `${base} · ${line}` : line;
}

// the email to the team (omar@ only — user, Nov 5 2026)
export const ALERT_EMAIL_TO = 'omar@airosofts.com';
export function portfolioEmail({ count, phone, name = '', said = '', reply = '', english = '', link = '', kind = 'agency' }) {
  const n = portfolioCount(count);
  const k = kindOf(kind);
  const dev = kind === 'developer';
  const who = name ? `${name} (${phone})` : phone;
  const subject = dev ? `WhatsApp: ${who} has a project with ${n} units` : `WhatsApp: ${who} has ${n} listings to migrate`;
  const text = [
    dev ? `${who} told us their project has ${n} units (${tierLabel(tierOf(n), kind)}).` : `${who} told us they have ${n} properties (${tierLabel(tierOf(n), kind)}).`,
    said ? `They wrote: "${String(said).slice(0, 500)}"` : '',
    reply ? `The assistant replied: "${String(reply).slice(0, 800)}"` : '',
    english ? `In English: "${String(english).slice(0, 800)}"` : '',
    `A person should write to them today to coordinate ${k.work} (${k.ask}).`,
    link ? `Open the chat: ${link}` : '',
  ].filter(Boolean).join('\n\n');
  const esc = (x) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { to: ALERT_EMAIL_TO, subject, text, html: text.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('') };
}

// From the chat (Relay messages): 'developer' when the newest CARTERA / PROYECTO tap is PROYECTO,
// else 'agency' (CARTERA, or no tap at all — someone asking about prices).
export function kindFromThread(messages = []) {
  const t = (m) => Date.parse(m?.timestamps?.created || m?.created_at || 0) || 0;
  const wordOf = (m) => [m?.text, m?.button?.text, m?.button?.payload, m?.interactive?.title, m?.interactive?.id]
    .map((v) => String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase())
    .find((v) => v === 'cartera' || v === 'proyecto');
  const taps = messages.filter((m) => m?.direction === 'inbound' && wordOf(m)).sort((a, b) => t(b) - t(a));
  return taps.length && wordOf(taps[0]) === 'proyecto' ? 'developer' : 'agency';
}
