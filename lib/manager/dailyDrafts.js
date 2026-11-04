// The daily follow-ups' emails for one day (lib/manager/daily.js loads the state). Pure —
// test/managerDaily.test.js.
import crypto from 'node:crypto';
import { safeBody, safeUrl } from './actions.js';
import { followupDraft } from './fixFollowups.js';
import { payReminderDraft, firstPayDraft } from './payFollowups.js';

// → the drafts to send today (pure apart from the state passed in)
export function dailyDrafts(state, { canEmail }) {
  const out = [];
  const add = (d) => {
    const buttonUrl = safeUrl(d.button_url, state.site);
    out.push({ id: crypto.randomUUID(), feedback_id: null, section: 'listings', ...d, body: safeBody(d.body, state.site), button_url: buttonUrl, button_label: buttonUrl ? d.button_label : null, status: 'draft' });
  };
  const ok = (uid) => canEmail(state.usersById.get(String(uid)));
  for (const c of state.checkouts) if (ok(c.user_id)) add(firstPayDraft(c, { listing: state.listingsById.get(String(c.property_id)), user: state.usersById.get(String(c.user_id)), site: state.site }));
  for (const t of state.payPlan.resend) if (ok(t.user_id)) add(payReminderDraft(t, { listing: state.listingsById.get(String(t.property_id)), user: state.usersById.get(String(t.user_id)), site: state.site, payments: state.payments }));
  for (const t of state.fixPlan.resend) if (ok(t.user_id)) add(followupDraft(t, { listing: state.listingsById.get(String(t.property_id)), user: state.usersById.get(String(t.user_id)), site: state.site }));
  return out;
}

