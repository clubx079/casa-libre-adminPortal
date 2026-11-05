// The agency offer by portfolio size (Roland, Nov 5 2026 — "Casa-Libre Agency Offer" brief).
// An agency taps CARTERA → the website asks how many properties they have and where they publish
// them (website lib/waKeywords.js carteraReply). Their answer reaches the Inbox assistant
// (lib/inboxAuto.js), which writes the offer for that size (rules in lib/aiPrompt.js) and returns
// the count it read ("portfolio"). This file decides what the count means — the tier, whether a
// person must take over, the alert note and the line saved on the lead. Pure —
// test/agencyOffer.test.js.
//   1–10      self-serve: the free listings each month, then the extra-listing price (send)
//   11–200    we migrate up to 100 free for 6 months, a person coordinates (send + alert + email)
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

export const TIER_LABEL = {
  self: '1–10 listings: self-serve',
  migrate: `11–${CUSTOM_ABOVE} listings: we migrate up to ${FREE_MIGRATED} free for ${FREE_MONTHS} months`,
  custom: `${CUSTOM_ABOVE}+ listings: custom offer`,
};

// the Alerts card / hand-over note
export const portfolioNote = (count) => {
  const n = portfolioCount(count);
  const tier = tierOf(n);
  if (!tier) return '';
  return `Agency portfolio: ${n} listings (${TIER_LABEL[tier]}). ${tier === 'self' ? 'The assistant sent the self-serve offer.' : 'The assistant sent the offer; a person coordinates the migration — ask for their website / portal link or Excel if they have not shared it.'}`;
};

// the line saved on their lead (potential_leads.notes) — one per lead, the newest count replaces it
const NOTE_RE = /\s*(?:·\s*)?Portfolio: \d+ listings \(WhatsApp, \d{4}-\d{2}-\d{2}\)/g;
export function leadNotes(notes, count, now = new Date()) {
  const n = portfolioCount(count);
  const base = String(notes || '').replace(NOTE_RE, '').trim();
  if (!n) return base || null;
  const line = `Portfolio: ${n} listings (WhatsApp, ${new Date(now).toISOString().slice(0, 10)})`;
  return base ? `${base} · ${line}` : line;
}

// the email to the team (omar@ only — user, Nov 5 2026)
export const ALERT_EMAIL_TO = 'omar@airosofts.com';
export function portfolioEmail({ count, phone, name = '', said = '', reply = '', english = '', link = '' }) {
  const n = portfolioCount(count);
  const who = name ? `${name} (${phone})` : phone;
  const subject = `WhatsApp: ${who} has ${n} listings to migrate`;
  const text = [
    `${who} told us they have ${n} properties (${TIER_LABEL[tierOf(n)] || ''}).`,
    said ? `They wrote: "${String(said).slice(0, 500)}"` : '',
    reply ? `The assistant replied: "${String(reply).slice(0, 800)}"` : '',
    english ? `In English: "${String(english).slice(0, 800)}"` : '',
    'A person should write to them today to coordinate the migration (their website / portal link or Excel).',
    link ? `Open the chat: ${link}` : '',
  ].filter(Boolean).join('\n\n');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return { to: ALERT_EMAIL_TO, subject, text, html: text.split('\n\n').map((p) => `<p>${esc(p)}</p>`).join('') };
}
