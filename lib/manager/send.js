// Admin Manager — send one personal email: automatically right after a report is written
// (lib/manager/run.js), or when an admin presses Send. The real address is read only now
// (the agent never sees it): the user's account email, or the email left with the feedback.
// Rendered with the same frame as every Casa Libre email, logged in email_log as
// automation 'manager', and the action is marked sent. Server-only.
import { dbFor } from '../db.js';
import { renderTemplate } from '../emailTemplateRender.js';
import { countryFrame } from '../automationAdmin.js';
import { sendManagerEmail } from '../email.js';
import { isInternalEmail } from '../internalTraffic.js';
import { isDeletedEmail } from '../userInsights.js';
import { TABLE } from './run.js';

const q = encodeURIComponent;

export async function recipientFor(db, action) {
  if (action.user_id) {
    const [u] = await db.select('users', `select=id,email,full_name&id=eq.${q(action.user_id)}&limit=1`);
    return u?.email ? { email: String(u.email).toLowerCase(), name: u.full_name || '' } : null;
  }
  if (action.feedback_id) {
    const [f] = await db.select('feedback', `select=id,email,name&id=eq.${q(action.feedback_id)}&limit=1`);
    return f?.email ? { email: String(f.email).toLowerCase(), name: f.name || '' } : null;
  }
  return null;
}

// → { ok, action } or { ok:false, status, error }
export async function sendAction(country, reportId, actionId, by) {
  const db = dbFor(country);
  const [row] = await db.select(TABLE, `select=id,actions&id=eq.${q(reportId)}&limit=1`);
  if (!row) return { ok: false, status: 404, error: 'report_not_found' };
  const actions = row.actions || [];
  const i = actions.findIndex((a) => a.id === actionId);
  if (i < 0) return { ok: false, status: 404, error: 'draft_not_found' };
  const a = actions[i];
  if (a.status === 'sent') return { ok: false, status: 409, error: 'already_sent' };

  const to = await recipientFor(db, a);
  if (!to) return { ok: false, status: 422, error: 'This person has no email address we can use.' };
  if (isDeletedEmail(to.email)) return { ok: false, status: 422, error: 'This account was deleted.' };
  if (isInternalEmail(to.email) && !process.env.MANAGER_SEND_TO) return { ok: false, status: 422, error: 'That is a team / test address.' };

  const msg = renderTemplate(
    { subject: a.subject, heading: a.heading, body: a.body, button_label: a.button_label, button_url: a.button_url },
    {},
    countryFrame(country),
  );
  const res = await sendManagerEmail({ country, to: to.email, ...msg });
  if (!res.ok) return { ok: false, status: 502, error: res.error };

  const sent = { ...a, status: 'sent', sent_at: new Date().toISOString(), sent_by: by || null, resend_id: res.id, sent_to: res.redirected ? `${res.to} (test, for ${to.email})` : to.email };
  const next = actions.map((x, k) => (k === i ? sent : x));
  await db.update(TABLE, `id=eq.${q(reportId)}`, { actions: next }, { returning: 'minimal' });
  // logged under the person (their activity page lists it, with a link to this report:
  // run_id = the report) — a local test redirect stays a 'test' row (left out of every rate)
  await db.insert('email_log', [{
    automation_id: 'manager', template_key: `manager_${a.kind}`, to_email: to.email, run_id: reportId,
    subject: msg.subject, resend_id: res.id, status: res.redirected ? 'test' : 'sent', channel: 'email',
  }], { returning: 'minimal' }).catch(() => {});
  return { ok: true, action: sent };
}
