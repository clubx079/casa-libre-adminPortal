// Automation email results — the honest answer to "does this email work?" (UTM Links page,
// "Automation emails" tab). Per automation, over a window:
//   sent      emails that went out (email_log, not tests / skips / team addresses)
//   clicked   of those, clicked in the email (Resend's last event per email)
//   landed    people who reached the site from it (PostHog page views tagged
//             utm_source=email · utm_medium=automation · utm_campaign=<automation>, added to
//             every link by the buyer site since 2026-10-26 — emails before that are untagged)
//   then      of the people who landed: signed up, listed a property, paid
//   whatsapp  WhatsApp messages sent / read (Relay statuses in email_log)
// Opens are left out on purpose: Apple Mail opens every email by itself. Pure —
// test/emailResults.test.js; the API (/api/email-results) fetches.
import { AUTOMATION_LABELS } from './whatsappAdmin.js';

// + the ones that are not on the Automations page's WhatsApp list
const LABELS = { ...AUTOMATION_LABELS, account_deleted: 'Goodbye (account deleted)', welcome: 'Welcome' };
const WENT_OUT = new Set(['sent', 'delivered', 'read', 'opened', 'clicked']);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

// logs: email_log rows { automation_id, channel, status, resend_id }; resendEvent: Map
// resend_id → last_event; landings: [{ campaign, people, visits, signedUp, listed, paid }].
export function emailResults({ logs = [], resendEvent = new Map(), landings = [] } = {}) {
  const by = new Map();
  const row = (id) => by.get(id) || by.set(id, {
    automation: id, label: LABELS[id] || id.replace(/_/g, ' '),
    sent: 0, clicked: 0, failed: 0, whatsappSent: 0, whatsappRead: 0,
    landed: 0, visits: 0, signedUp: 0, listed: 0, paid: 0,
  }).get(id);
  for (const m of logs) {
    if (!m.automation_id || ['wa_campaign', 'newsletter', 'manager'].includes(m.automation_id)) continue;
    const st = String(m.status || '').toLowerCase();
    const r = row(m.automation_id);
    if (m.channel === 'whatsapp') {
      if (WENT_OUT.has(st)) { r.whatsappSent += 1; if (st === 'read') r.whatsappRead += 1; }
      continue;
    }
    if (st === 'failed' || st === 'bounced') { r.failed += 1; continue; }
    if (!WENT_OUT.has(st)) continue;
    r.sent += 1;
    if (String(resendEvent.get(m.resend_id) || '').toLowerCase() === 'clicked') r.clicked += 1;
  }
  for (const l of landings) {
    if (!l.campaign || l.campaign === '?') continue;
    const r = row(l.campaign);
    r.landed += l.people || 0; r.visits += l.visits || 0;
    r.signedUp += l.signedUp || 0; r.listed += l.listed || 0; r.paid += l.paid || 0;
  }
  return [...by.values()]
    .map((r) => ({ ...r, clickRate: pct(r.clicked, r.sent), landedRate: pct(r.landed, r.sent), readRate: pct(r.whatsappRead, r.whatsappSent) }))
    .sort((a, b) => (b.sent + b.whatsappSent) - (a.sent + a.whatsappSent) || b.landed - a.landed);
}
