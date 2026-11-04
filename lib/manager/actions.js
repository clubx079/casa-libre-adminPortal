// Admin Manager — the agent's draft emails → the review queue on the report page. Nothing
// is sent from here: an admin reads each draft, edits it if needed, and presses Send
// (lib/manager/send.js) or Dismiss. Pure — test/managerActions.test.js.
import { DRAFT_KINDS } from './prompt.js';

// No cap on how many emails a report sends, and no "not the same person for 14 days" rule:
// every person who needs an email gets one. The only guard is that the SAME problem (the same
// feedback, the same listing) is never answered twice — itemKey / answeredItems below.
const UUID_RE = /^[0-9a-f-]{36}$/i;
const ID_RE = /^[0-9a-zA-Z-]{1,64}$/;

// A button / link may only point at the country's own site.
export function safeUrl(url, site) {
  const u = String(url || '').trim();
  if (!u) return null;
  try {
    const parsed = new URL(u);
    const home = new URL(site);
    return parsed.protocol === 'https:' && parsed.host === home.host ? parsed.toString() : null;
  } catch { return null; }
}

// [text](url) links in the body that leave the site lose the link (the text stays).
export function safeBody(body, site) {
  return String(body || '').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => (safeUrl(url, site) ? m : text)).trim();
}

// drafts: report.drafts. opts: { site, newId(), skipUser(userId) → true to drop (team, unknown),
// answered: Set of itemKey()s already sent or dismissed in earlier reports (the same feedback /
// the same listing problem is never emailed twice),
// blocked: Set of `user:<id>` / `feedback:<id>` judged a false flag or a bot — never drafted }.
// → { actions, dropped: [{ reason, draft }] }
export function buildActions(drafts = [], { site, newId, skipUser = () => false, answered = new Set(), blocked = new Set() } = {}) {
  const actions = [];
  const dropped = [];
  const seen = new Set();
  for (const d of drafts) {
    const kind = DRAFT_KINDS.includes(d?.kind) ? d.kind : 'other';
    const userId = UUID_RE.test(String(d?.user_id || '')) ? d.user_id : null;
    const feedbackId = ID_RE.test(String(d?.feedback_id || '')) ? String(d.feedback_id) : null;
    const propertyId = UUID_RE.test(String(d?.property_id || '')) ? d.property_id : null;
    const target = userId ? `user:${userId}` : feedbackId ? `feedback:${feedbackId}` : null;
    if (!target) { dropped.push({ reason: 'no user or feedback to send to', draft: d }); continue; }
    if (userId && skipUser(userId)) { dropped.push({ reason: 'team / test / unknown account', draft: d }); continue; }
    if (blocked.has(target) || (feedbackId && blocked.has(`feedback:${feedbackId}`))) { dropped.push({ reason: 'false flag or bot', draft: d }); continue; }
    const key = `${target}:${kind}:${feedbackId || propertyId || ''}`;
    if (seen.has(key)) { dropped.push({ reason: 'duplicate in this report', draft: d }); continue; }
    const item = itemKey({ kind, feedback_id: feedbackId, property_id: propertyId });
    if (item && answered.has(item)) { dropped.push({ reason: 'this problem was already answered', draft: d }); continue; }
    if (!String(d.subject || '').trim() || !String(d.body || '').trim()) { dropped.push({ reason: 'empty subject or body', draft: d }); continue; }
    seen.add(key);
    const buttonUrl = safeUrl(d.button_url, site);
    actions.push({
      id: newId(),
      kind,
      user_id: userId,
      feedback_id: feedbackId,
      property_id: propertyId,
      section: d.section ? String(d.section).slice(0, 30) : null,
      reason: String(d.reason || '').trim(),
      evidence: String(d.evidence || '').trim(),
      subject: String(d.subject).trim().slice(0, 200),
      heading: String(d.heading || '').trim().slice(0, 200),
      body: safeBody(d.body, site),
      button_label: buttonUrl ? String(d.button_label || '').trim().slice(0, 60) || null : null,
      button_url: buttonUrl,
      status: 'draft',
    });
  }
  return { actions, dropped };
}

// The problem an email is about: the same feedback, or the same listing, for this kind. An email
// with neither (a general one) has no item key and is never blocked by an earlier one.
export const itemKey = (a) => (a?.feedback_id ? `${a.kind}:feedback:${a.feedback_id}` : a?.property_id ? `${a.kind}:listing:${a.property_id}` : null);

// itemKey()s of every email sent or dismissed in these reports (no time limit within them).
export function answeredItems(reports = []) {
  const keys = new Set();
  for (const r of reports) {
    for (const x of r.actions || []) {
      if (x.status !== 'sent' && x.status !== 'dismissed') continue;
      const k = itemKey(x);
      if (k) keys.add(k);
    }
  }
  return keys;
}

// An admin's edit of a draft: only the text fields, checked the same way.
export function applyEdit(action, input = {}, site) {
  const next = { ...action };
  if (input.subject !== undefined) next.subject = String(input.subject).trim().slice(0, 200);
  if (input.heading !== undefined) next.heading = String(input.heading).trim().slice(0, 200);
  if (input.body !== undefined) next.body = safeBody(input.body, site);
  if (input.button_url !== undefined || input.button_label !== undefined) {
    const url = safeUrl(input.button_url !== undefined ? input.button_url : next.button_url, site);
    next.button_url = url;
    next.button_label = url ? String(input.button_label !== undefined ? input.button_label : next.button_label || '').trim().slice(0, 60) || null : null;
  }
  const errors = {};
  if (!next.subject) errors.subject = 'The subject is required.';
  if (!next.body) errors.body = 'Write the email.';
  if ((input.button_url || '').trim() && !next.button_url) errors.button_url = 'The button must link to the Casa Libre site (https).';
  return { ok: Object.keys(errors).length === 0, action: next, errors };
}

// The people a report judged a false flag (claim_checks) or a bot (suspicious): no draft
// emails for them. → Set of `user:<id>` / `feedback:<id>`.
export function blockedTargets(report = {}) {
  const out = new Set();
  const add = (x) => {
    if (UUID_RE.test(String(x?.user_id || ''))) out.add(`user:${x.user_id}`);
    if (ID_RE.test(String(x?.feedback_id || ''))) out.add(`feedback:${x.feedback_id}`);
  };
  for (const c of report.claim_checks || []) if (c.verdict === 'false_flag') add(c);
  for (const x of report.suspicious || []) if (x.verdict === 'bot') add(x);
  return out;
}
