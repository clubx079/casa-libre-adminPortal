// One person's email history for the user page: every email Resend sent them
// (sign-in codes, welcome, listing published, promotion ending, automations…) with
// its latest status, plus automation emails from our own email_log that Resend no
// longer lists. Pure helpers (no fetch) so vitest can check them
// (test/userEmails.test.js).
import { emailType } from './emailStats.js';

// Codes are opened inside the mail app's preview or copied from the notification,
// so their "open rate" says nothing about engagement: they are left out of the rates.
export const CODE_TYPES = new Set(['Sign-in code', 'Password reset']);

// Automation templates are written (and named) in Spanish; the admin shows an English
// name next to them. Unknown templates → null (the subject translation still shows).
const TEMPLATE_NAMES_EN = {
  'first-listing-gift': 'First listing — free home display gift',
  'first-listing-ending': 'First listing — free home display ending',
  'listing-views': 'Listing views milestone',
  'draft-reminder': 'Unfinished draft reminder',
};
export const englishTemplateName = (key) => TEMPLATE_NAMES_EN[key] || null;

const OPENED = new Set(['opened', 'clicked']);
const DELIVERED = new Set(['delivered', 'opened', 'clicked']);

const lower = (v) => String(v || '').trim().toLowerCase();
const recipients = (to) => (Array.isArray(to) ? to : [to]).map(lower);

// resendRows: Resend "List sent emails" objects (any recipients, any order).
// logRows:    email_log rows (automation sends; status 'test' = admin test send).
// templateNames: { template_key: readable name }.
// tracking: the domain's open/click tracking (emailStats trackingFor). An email Resend
//   lists still has its delivery status, but opens/clicks only exist if tracking was on
//   when it was sent. untracked says why not: 'before' (sent before tracking was
//   switched on), 'off' (tracking off for the domain), 'log' (only in our log).
export function mergeUserEmails({ email, resendRows = [], logRows = [], templateNames = {}, tracking = { on: true, since: null } }) {
  const me = lower(email);
  if (!me) return [];
  const logByResend = new Map(logRows.filter((l) => l.resend_id).map((l) => [l.resend_id, l]));
  const nameOf = (l) => templateNames[l.template_key] || l.template_key || 'Automation';
  const out = [];
  const seen = new Set();

  for (const r of resendRows) {
    if (!recipients(r.to).includes(me)) continue;
    const log = logByResend.get(r.id);
    if (log && log.status === 'test') continue;
    seen.add(r.id);
    const untracked = !tracking.on ? 'off'
      : tracking.since && Date.parse(r.created_at) < Date.parse(tracking.since) ? 'before'
      : null;
    out.push({
      id: r.id,
      at: r.created_at,
      subject: r.subject || '',
      type: log ? nameOf(log) : emailType(r.subject),
      template_key: log?.template_key || null,
      automation: !!log,
      status: lower(r.last_event) || 'sent',
      listed: true, // Resend has it: delivery status is real
      tracked: !untracked,
      untracked,
    });
  }
  for (const l of logRows) {
    if (l.status === 'test' || lower(l.to_email) !== me) continue;
    const id = l.resend_id || l.id;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      at: l.created_at,
      subject: l.subject || '',
      type: nameOf(l),
      template_key: l.template_key || null,
      automation: true,
      status: l.status === 'sending' ? 'sending' : 'sent',
      listed: false,
      tracked: false, // Resend didn't list it (no read key, or past Resend's history)
      untracked: 'log',
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// Codes and admin test sends say nothing about engagement: left out of every rate.
const notEngagement = (r) => CODE_TYPES.has(r.type) || r.type === 'Test send';

// Delivered: out of the emails Resend lists (delivery is always recorded).
// Open / click rates: only emails sent while tracking was on. One decimal, or null.
export function userEmailSummary(rows = []) {
  const listed = rows.filter((r) => r.listed && !notEngagement(r));
  const measured = rows.filter((r) => r.tracked && !notEngagement(r));
  const opened = measured.filter((r) => OPENED.has(r.status)).length;
  const clicked = measured.filter((r) => r.status === 'clicked').length;
  const pct = (n) => (measured.length ? Math.round((n / measured.length) * 1000) / 10 : null);
  return {
    total: rows.length,
    codes: rows.filter((r) => CODE_TYPES.has(r.type)).length,
    listed: listed.length,
    delivered: listed.filter((r) => DELIVERED.has(r.status)).length,
    measured: measured.length,
    opened,
    clicked,
    openRate: pct(opened),
    clickRate: pct(clicked),
  };
}

// English subject for an automation email WITHOUT sending the person's details to a
// translation service: the TEMPLATE subject ({{tags}} kept) is what gets translated,
// then the values are read back out of the sent Spanish subject and filled in.
const TAG = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// '{{name}}, tu propiedad…' + 'Claudia, tu propiedad…' → { name: 'Claudia' }, or null
// when the sent subject doesn't fit the template (e.g. it was edited since).
export function templateValues(template, subject) {
  const tpl = String(template || '');
  if (!tpl) return null;
  const keys = [];
  let re = '';
  let last = 0;
  for (const m of tpl.matchAll(TAG)) {
    re += escRe(tpl.slice(last, m.index)) + '(.+?)';
    keys.push(m[1]);
    last = m.index + m[0].length;
  }
  re += escRe(tpl.slice(last));
  const hit = String(subject || '').match(new RegExp(`^${re}$`, 's'));
  if (!hit) return null;
  return Object.fromEntries(keys.map((k, i) => [k, hit[i + 1]]));
}

export function fillTemplate(template, values = {}) {
  let missing = false;
  const out = String(template || '').replace(TAG, (_, k) => {
    if (values[k] == null) { missing = true; return ''; }
    return values[k];
  });
  return missing ? null : out;
}
