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

// Subjects written by the buyer portal (lib/email.js) → a readable type.
const TYPES = [
  ['Sign-in code', /es tu código de Casa Libre/i],
  ['Password reset', /restablecer la contraseña/i],
  ['Welcome', /^Bienvenid/i],
  ['Listing published', /está publicada/i],
  ['Promotion ending', /vence en|deja la portada/i],
  ['Investor inquiry', /consulta de inversor/i],
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

// rows: Resend email objects already limited to the country + time window.
export function summarize(rows) {
  const blank = () => ({ sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0 });
  const totals = blank();
  const byType = {};
  const byDay = {};
  for (const e of rows) {
    const ev = String(e.last_event || 'sent').toLowerCase();
    const t = emailType(e.subject);
    const d = String(e.created_at || '').slice(0, 10);
    for (const bucket of [totals, (byType[t] ||= blank()), (byDay[d] ||= blank())]) {
      bucket.sent += 1;
      if (DELIVERED.has(ev)) bucket.delivered += 1;
      if (OPENED.has(ev)) bucket.opened += 1;
      if (ev === 'clicked') bucket.clicked += 1;
      if (FAILED.has(ev)) bucket.failed += 1;
    }
  }
  const rate = (b) => (b.sent ? Math.round((b.opened / b.sent) * 1000) / 10 : 0);
  return {
    totals: { ...totals, openRate: rate(totals) },
    byType: Object.entries(byType)
      .map(([type, b]) => ({ type, ...b, openRate: rate(b) }))
      .sort((a, b) => b.sent - a.sent),
    byDay: Object.entries(byDay).sort(([a], [b]) => (a < b ? -1 : 1)).map(([day, b]) => ({ day, ...b })),
  };
}
