// Email analytics from Resend: count what the buyer portal sent, and how many were
// opened. Pure helpers (no fetch) so they can be checked with plain node.
//
// Resend's "List sent emails" returns each email with its LATEST status
// (`last_event`). Statuses move forward sent → delivered → opened → clicked, so an
// email whose last event is "clicked" was also opened. Opens are only recorded on
// domains with open tracking switched on in Resend.

// Each country's site sends from its own domain (see buyer portal lib/email.js).
export const SENDER_DOMAIN = {
  py: 'casa-libre.com.py',
  bo: 'casa-libre.com.bo',
  uy: 'uy.casa-libre.com',
  ve: 'casa-libre.com.ve',
};

// Open + click tracking is a per-domain switch in Resend. Paraguay's was turned on
// on Sep 24, 2026 (its first recorded open: 23:38 UTC); emails sent before that can
// only ever show "delivered". The other countries' domains have it off (Resend audit
// 2026-10-04). Update this when a domain's tracking is switched on.
const TRACKING_SINCE = {
  py: '2026-09-24T23:38:00Z',
};
export function trackingFor(country) {
  const since = TRACKING_SINCE[country] || null;
  return { on: !!since, since };
}

// Subjects written by the buyer portal (lib/email.js), its automations and the one-off
// sends → a readable type. Order matters: test sends first.
const TYPES = [
  ['Test send', /^\[TEST\]|sender test|prueba de entrega|\b(ENV|SENDER) TEST\b/i],
  ['Sign-in code', /es tu código de Casa Libre/i],
  ['Password reset', /restablecer la contraseña/i],
  ['Welcome', /^Bienvenid/i],
  ['Listing published', /está publicada/i],
  ['Promotion ending', /vence en|deja la portada/i],
  // the free "home display" gift: the Sep 21 welcome sends by hand (ES/EN) and the
  // first-listing automation ("{{name}}, tu propiedad está en la portada…")
  ['Free home display gift', /destacada en la portada|featured on the Casa Libre homepage|está en la portada de Casa Libre/i],
  ['Listing views', /ya tiene \d[\d.,]* visitas/i],
  ['Investor inquiry', /consulta de inversor|investor inquiry/i],
  ['Book a call', /^Book a call/i],
];
export function emailType(subject) {
  const s = String(subject || '');
  for (const [name, re] of TYPES) if (re.test(s)) return name;
  return 'Other';
}

const OPENED = new Set(['opened', 'clicked']);
const DELIVERED = new Set(['delivered', 'opened', 'clicked']);
const FAILED = new Set(['bounced', 'complained', 'failed', 'suppressed']);

export function fromDomain(from) {
  const m = String(from || '').match(/@([^>\s]+)/);
  return m ? m[1].toLowerCase() : '';
}

// Sign-in / reset codes are read in the notification or copied, so they say nothing
// about engagement: they stay out of the open / click numbers.
const CODE_TYPES = new Set(['Sign-in code', 'Password reset']);

// rows: Resend email objects already limited to the country + time window (and with
// team / test emails already removed by the caller).
// sent / delivered / failed count every email. opened / clicked and their rates count
// only `measured` emails: not a code, and sent while open tracking was on
// (trackingSince, see trackingFor) — earlier emails can never show an open.
export function summarize(rows, { trackingSince = null } = {}) {
  // opened / clicked: every real open / click (codes too). mOpened / mClicked: the
  // same, but only among `measured` emails — what the rates are made of.
  const blank = () => ({ sent: 0, delivered: 0, failed: 0, opened: 0, clicked: 0, measured: 0, mOpened: 0, mClicked: 0 });
  const totals = blank();
  const byType = {};
  const byDay = {};
  const since = trackingSince ? Date.parse(trackingSince) : null;
  for (const e of rows) {
    const ev = String(e.last_event || 'sent').toLowerCase();
    const t = emailType(e.subject);
    const d = String(e.created_at || '').slice(0, 10);
    const measured = !CODE_TYPES.has(t) && (since == null || Date.parse(e.created_at) >= since);
    for (const bucket of [totals, (byType[t] ||= blank()), (byDay[d] ||= blank())]) {
      bucket.sent += 1;
      if (DELIVERED.has(ev)) bucket.delivered += 1;
      if (FAILED.has(ev)) bucket.failed += 1;
      if (OPENED.has(ev)) bucket.opened += 1;
      if (ev === 'clicked') bucket.clicked += 1;
      if (measured) {
        bucket.measured += 1;
        if (OPENED.has(ev)) bucket.mOpened += 1;
        if (ev === 'clicked') bucket.mClicked += 1;
      }
    }
  }
  const pct = (n, b) => (b.measured ? Math.round((n / b.measured) * 1000) / 10 : null);
  const withRates = (b) => ({ ...b, openRate: pct(b.mOpened, b), clickRate: pct(b.mClicked, b) });
  return {
    totals: withRates(totals),
    byType: Object.entries(byType)
      .map(([type, b]) => ({ type, ...withRates(b) }))
      .sort((a, b) => b.sent - a.sent),
    byDay: Object.entries(byDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, b]) => ({ day, ...b })),
  };
}
