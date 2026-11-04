// Open issues — for every issue, the answer to "what did we already do about it?", from the
// person's whole message and send history:
//   handled   yes / no, and by whom: the AI assistant, an automation (email / WhatsApp), the
//             Admin Manager (email / WhatsApp), a team member (in the chat or from Open issues)
//             — newest first, with when and whether it was read / opened
//   their     what THEY did that matters here: tapped SÍ / CARTERA / PROYECTO, opted out (BAJA)
//   goal      what we want to happen, and whether it happened
//   reminders will more go out by themselves, and when — or why not
// The suggestion stays the issue's own. Pure — test/openIssuesHandling.test.js.
import { GOAL_TEXT } from './openIssues.js';

const D = 86400000;
const H = 3600000;
const t = (x) => Date.parse(x || 0) || 0;
const day = (ms) => new Date(ms).toISOString().slice(0, 10);
const key8 = (p) => String(p || '').replace(/\D/g, '').slice(-8);
const meta = (r) => { if (r?.meta) return r.meta; try { return JSON.parse(r?.error || '{}') || {}; } catch { return {}; } };

const AUTOMATION = {
  listing_held: 'listing not published', payment_followup: 'waiting for payment', draft_reminders: 'unfinished draft',
  listing_views_milestone: 'listing views', first_listing_free_home: 'first-listing gift', duplicate_listings: 'same listing twice',
  no_listing_nudge: 'no listing yet', paid_listings: 'paid listings', welcome: 'welcome',
};
// which history rows belong to which kind of issue
const TOPIC = {
  messages: (r) => ['inbox_ai', 'inbox_ai_person', 'open_issue', 'wa_reply'].includes(r.automation_id),
  payment: (r) => ['listing_held', 'payment_followup'].includes(r.automation_id) || (r.automation_id === 'manager' && /^manager_(unpaid|payment)/.test(r.template_key || ''))
    || (r.automation_id === 'open_issue' && /gift|payment/i.test(`${meta(r).action || ''} ${r.subject || ''}`)) || (r.automation_id === 'inbox_ai' && meta(r).goal === 'pay'),
  views: (r) => ['manager_views', 'listing_views_milestone'].includes(r.automation_id) || (r.automation_id === 'open_issue' && /view/i.test(r.subject || '')),
  draft: (r) => r.automation_id === 'draft_reminders' || (r.automation_id === 'manager' && r.template_key === 'manager_stuck_draft') || (r.automation_id === 'inbox_ai' && meta(r).goal === 'finish_draft'),
  security: () => false,
};
const TOPIC_OF = { unanswered: 'messages', keyword: 'messages', followup: 'messages', payment: 'payment', views: 'views', funnel: null, security: 'security' };

// one history row → { at, by, what, status }
export function historyItem(r) {
  const m = meta(r);
  const ch = r.channel === 'whatsapp' ? 'WhatsApp' : 'email';
  const st = ['read', 'delivered', 'opened', 'clicked'].includes(r.status) ? r.status : r.status === 'test' ? 'test send' : null;
  switch (r.automation_id) {
    case 'inbox_ai': return { at: r.created_at, by: 'AI assistant (WhatsApp)', what: m.english || r.subject || 'answered', status: st };
    case 'inbox_ai_person': return { at: r.created_at, by: 'AI assistant (WhatsApp)', what: `passed it to a person${m.note || m.reason ? ` — ${m.note || m.reason}` : ''}`, status: st };
    case 'open_issue': return { at: r.created_at, by: `Team via Open issues${m.by ? ` (${m.by})` : ''}`, what: m.action === 'gift' ? 'published the listings free as a gift' : (m.english || (r.subject ? `“${r.subject}”` : `sent a ${ch}`)), status: st };
    case 'manager': return { at: r.created_at, by: `Admin Manager (${ch})`, what: r.subject ? `“${r.subject}”` : r.template_key || 'personal email', status: st };
    case 'manager_views': return { at: r.created_at, by: `Admin Manager (${ch})`, what: `views advice${m.views != null ? ` — ${m.views} views, ${m.contacts ?? 0} contacts` : ''}`, status: st };
    case 'wa_reply': return { at: r.created_at, by: 'Them', what: r.subject || `replied ${String(r.template_key || '').toUpperCase()}`, status: null, them: true };
    default: return { at: r.created_at, by: `Automation (${ch})`, what: `${AUTOMATION[r.automation_id] || r.automation_id}${r.subject && !/^WhatsApp · /.test(r.subject) ? `: “${r.subject}”` : ''}`, status: st };
  }
}

const GOAL = {
  unanswered: 'They get an answer from us',
  keyword: 'A person from the team talks to them',
  payment: 'The listing gets paid (or published as a gift)',
  payment_promo: 'They finish buying it',
  views: 'A buyer contacts them',
  funnel_draft: 'The draft becomes a live listing',
  funnel_checkout: 'The payment goes through',
  security: 'A person checks the suspension (keep or lift)',
};

// ctx: { history: email_log rows (any person; their meta in .error), teamByPhone: Map phone8 → [{at, by}],
//        payThreads: Map `${user}:${property}` → thread (lib/manager/payFollowups.js), suspensions,
//        draftSteps, now, gapH (payment reminder gap, 40) }
export function handlingFor(issue, ctx) {
  const { history = [], teamByPhone = new Map(), payThreads = new Map(), suspensions = [], draftSteps = 0, now = Date.now(), gapH = 40, maxSends = 4 } = ctx;
  const p = issue.person || {};
  const mail = String(p.email || '').toLowerCase();
  const ph = key8(p.phone);
  const mine = history.filter((r) => (mail && String(r.to_email || '').toLowerCase() === mail) || (ph.length === 8 && key8(r.to_phone) === ph));
  const sub = issue.type === 'funnel' ? (String(issue.id).startsWith('funnel:checkout') ? 'payment' : 'draft') : TOPIC_OF[issue.type];
  const since = t(issue.since) - 2 * D;   // what was done about THIS problem (a little before it showed)
  const rows = sub && TOPIC[sub] ? mine.filter((r) => TOPIC[sub](r) && t(r.created_at) >= since) : [];
  const items = rows.map(historyItem);
  if (sub === 'messages') for (const m of teamByPhone.get(ph) || []) if (t(m.at) >= since) items.push({ at: m.at, by: `Team (${m.by})`, what: 'wrote in the chat', status: null });
  const theirs = mine.filter((r) => r.automation_id === 'wa_reply').map(historyItem);   // their taps / opt-out, any time
  items.sort((a, b) => t(b.at) - t(a.at));
  const ours = items.filter((x) => !x.them);

  // the goal
  let goal;
  if (issue.type === 'followup') goal = { text: `They ${GOAL_TEXT[issue.data?.goal]?.[0] || 'do what we asked'}`, reached: issue.status === 'achieved' || !!issue.achieved };
  else if (issue.type === 'payment' && issue.data?.plan && issue.data.plan !== 'listing') goal = { text: GOAL.payment_promo, reached: false };
  else goal = { text: GOAL[issue.type === 'funnel' ? `funnel_${sub === 'payment' ? 'checkout' : 'draft'}` : issue.type] || 'Solved', reached: issue.status === 'achieved' };

  // will more go out by themselves?
  let reminders;
  const thread = [...payThreads.values()].find((th) => String(th.user_id) === String(p.userId) && (issue.data?.propertyIds || [issue.data?.propertyId]).filter(Boolean).map(String).includes(String(th.property_id)));
  if (sub === 'payment') {
    if (thread) {
      const n = thread.sends.length;
      const last = t(thread.sends[n - 1]?.at);
      const next = day(Math.max(now, last + gapH * H));
      reminders = n >= maxSends ? `No — the first email and all ${maxSends - 1} reminders were sent (${thread.sends.map((s) => day(t(s.at)).slice(5)).join(', ')}).`
        : n === 1 ? `Yes — the first payment email went out ${day(last)}; reminder 1 of ${maxSends - 1} goes out from ${next}.`
        : `Yes — ${n - 1} of ${maxSends - 1} reminders sent (last ${day(last)}); reminder ${n} of ${maxSends - 1} goes out from ${next}.`;
    } else if (String(issue.id).startsWith('funnel:checkout')) {
      reminders = issue.data?.propertyId ? 'Not yet — the daily run sends the first payment email (if we have their email address).' : 'No — this checkout has no listing, so no automatic payment email: write to them.';
    } else reminders = 'No Admin Manager payment email yet — it starts when they open the payment (checkout). Until then only the website’s own reminders.';
  } else if (sub === 'draft') reminders = draftSteps ? `No — all ${draftSteps} automatic draft reminders were sent.` : 'No — the draft reminders are switched off.';
  else if (issue.type === 'views') {
    const adv = mine.filter((r) => r.automation_id === 'manager_views').sort((a, b) => t(b.created_at) - t(a.created_at))[0];
    reminders = adv ? `No — the advice goes once per listing every 30 days (next possible ${day(t(adv.created_at) + 30 * D)}).` : 'The Admin Manager sends the advice by itself on its next run.';
  } else if (issue.type === 'security') reminders = 'No — one email was sent when the account was suspended.';
  else if (issue.type === 'followup') reminders = 'No automatic reminder — use the button to resend the link.';
  else reminders = 'No automatic reminder — this one needs a person.';

  if (issue.type === 'security') {
    const s = suspensions.find((x) => String(x.user_id) === String(p.userId));
    if (s) ours.unshift({ at: s.at, by: 'Security watch (email)', what: s.notified ? 'suspended the account and emailed them' : 'suspended the account (no email address)', status: null });
  }
  return {
    handled: ours.length > 0,
    by: [...new Set(ours.map((x) => x.by.replace(/ \(.*\)$/, (m) => m)))].slice(0, 4),
    items: ours.slice(0, 8),
    their: theirs.slice(0, 4),
    goal,
    reminders,
  };
}

export const attachHandling = (issues, ctx) => issues.map((i) => ({ ...i, track: handlingFor(i, ctx) }));
