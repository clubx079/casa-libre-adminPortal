// Email & WhatsApp campaigns — every automated message Casa-Libre sends, named and grouped, with
// what happened to it, and this week against the week before. Pure — test/messageCampaigns.test.js.
// The page /email-campaigns and the Overview cards read it through lib/messageCampaignsData.js.
//
// Two sources, so nothing ends up in an unnamed "Other" pile:
//   1. email_log (each country's DB): every message an automation sent, email or WhatsApp, with
//      the automation that sent it. Emails are matched to Resend by resend_id for opens / clicks;
//      WhatsApp status comes from Relay (sent → delivered → read, or failed).
//   2. Resend emails that no automation logged: the site's own emails (sign-in codes, welcome,
//      listing published, referral invites…) named by their subject (lib/emailStats.js emailType).
// Left out: Inbox replies (inbox_ai*: conversations, not campaigns), team notices, event records
// (channel 'event' — a deleted listing, a referral code: not messages), tests and skips.
import { emailType } from './emailStats.js';

export const GROUPS = [
  { key: 'profile', label: 'Profile and account', about: 'Getting people to complete their profile and photo, and saying goodbye when they leave.' },
  { key: 'list', label: 'Getting people to list', about: 'People who signed up or started a listing but did not publish yet.' },
  { key: 'listings', label: 'Live listings', about: 'Owners whose home is on the site: views, gifts, duplicates, deleted listings.' },
  { key: 'money', label: 'Payments', about: 'Paid listings ending, and the plan for agents.' },
  { key: 'referrals', label: 'Referrals', about: 'The invite-a-friend program.' },
  { key: 'broadcast', label: 'Newsletters and notices', about: 'One message to many people at once.' },
  { key: 'team', label: 'Sent by the team', about: 'Personal follow-ups the Admin Manager drafts and a person approves, and WhatsApp campaigns to agencies.' },
  { key: 'site', label: 'Site emails', about: 'Sent by the site itself when someone does something. Not campaigns, so they are not in the totals.' },
];

// key → { label, group, about (what we send), href (where it is managed) }
export const CATALOG = {
  profile_personalization: { label: 'Profile personalization', group: 'profile', about: 'Your photo and details now show on your listings; your profile is N% complete.', href: '/profile-pro' },
  profile_photo_face: { label: 'Show your face', group: 'profile', about: 'People with a logo or no photo: a real photo brings more enquiries.', href: '/automations' },
  account_deleted: { label: 'Goodbye (account deleted)', group: 'profile', about: 'Sent when someone deletes their account.', href: '/automations' },
  no_listing_nudge: { label: 'Signed up, no listing yet', group: 'list', about: 'Your first listing is free.', href: '/automations' },
  draft_reminders: { label: 'Unfinished draft reminders', group: 'list', about: 'You are almost done publishing your home.', href: '/automations' },
  payment_followup: { label: 'Waiting for payment', group: 'list', about: 'Your listing is saved, one step left (then a free listing as a gift).', href: '/automations' },
  listing_held: { label: 'Listing not published', group: 'list', about: 'Payment missing, photos rejected, paused or missing details.', href: '/automations' },
  first_listing_free_home: { label: 'First listing: free home-page spot', group: 'listings', about: 'A gift: your home on the home page, and a reminder before it ends.', href: '/automations' },
  listing_views_milestone: { label: 'Listing getting views', group: 'listings', about: 'Your home already has N views.', href: '/automations' },
  listing_saves_milestone: { label: 'Listing getting saved', group: 'listings', about: 'People saved your home.', href: '/automations' },
  manager_views: { label: 'Views but no contacts', group: 'listings', about: 'Your home gets views but nobody writes: tips to fix it.', href: '/manager' },
  duplicate_listings: { label: 'Same property listed twice', group: 'listings', about: 'You published the same property more than once.', href: '/automations' },
  listing_deleted: { label: 'Listing deleted: ask why', group: 'listings', about: 'Why did you delete your listing?', href: '/automations' },
  paid_listings: { label: 'Paid listing ending / ended', group: 'money', about: 'Your listing ends in N days, or has ended; the plan for agents.', href: '/paid-features' },
  referrals: { label: 'Referral rewards', group: 'referrals', about: 'You earned Verified days or the home page; your reward ends soon.', href: '/referrals' },
  referral_promo: { label: 'Promote the referral program', group: 'referrals', about: 'Invite someone to list and earn the Verified badge.', href: '/referrals' },
  newsletter: { label: 'Newsletters and notices', group: 'broadcast', about: 'News (the app is out), the ueno bank notice and other one-time messages.', href: '/email-templates' },
  manager: { label: 'Admin Manager follow-ups', group: 'team', about: 'Personal reminders about one listing (a detail, the location…), approved by a person.', href: '/manager' },
  wa_campaign: { label: 'WhatsApp campaigns to agencies', group: 'team', about: 'Batches to agents and agencies (mascot video, statistics…).', href: '/campaigns' },
  // site emails (Resend only), by subject type
  'site:Sign-in code': { label: 'Sign-in codes', group: 'site', about: 'The 6-digit code to sign in.', noRates: true },
  'site:Password reset': { label: 'Password reset', group: 'site', about: 'Reset your password.', noRates: true },
  'site:Welcome': { label: 'Welcome', group: 'site', about: 'Welcome to Casa-Libre, right after signing up.' },
  'site:Listing published': { label: 'Listing published', group: 'site', about: 'Your home is published.' },
  'site:Promotion ending': { label: 'Promotion ending', group: 'site', about: 'Your Verified badge or home-page spot ends soon.' },
  'site:Referral invite': { label: 'Referral invites', group: 'referrals', about: 'An invite a member sends to a friend from their account.', href: '/referrals' },
  'site:Referral reward': { label: 'Referral rewards', group: 'referrals', about: 'You earned Verified days or the home page.', href: '/referrals' },
  'site:Referral reward ending': { label: 'Referral reward ending', group: 'referrals', about: 'Your reward ends soon.', href: '/referrals' },
  'site:Agents plan': { label: 'Plan for agents', group: 'money', about: 'The offer of the plan for agents.' },
  'site:One-off': { label: 'One-off emails', group: 'site', about: 'Sent once by hand. Their subjects are listed below.' },
};
// subject types (lib/emailStats.js) that belong to an automation above
const TYPE_TO_KEY = {
  Newsletter: 'newsletter', 'ueno bank notice': 'newsletter', 'No listing yet': 'no_listing_nudge',
  'Free home display gift': 'first_listing_free_home', 'Listing views': 'listing_views_milestone',
  'Draft reminder': 'draft_reminders', 'Duplicate listing': 'duplicate_listings', 'Paid listing ending': 'paid_listings',
  'Paid listing ended': 'paid_listings', 'Listing not published': 'listing_held', 'Referral program promo': 'referral_promo',
  'Profile personalization': 'profile_personalization', 'Show your face': 'profile_photo_face', 'Admin Manager follow-up': 'manager',
  Goodbye: 'account_deleted', 'Listing deleted': 'listing_deleted',
};
const SKIP_AUTOMATIONS = new Set(['inbox_ai', 'inbox_ai_person', 'open_issue']);
const SKIP_TYPES = new Set(['Test send', 'Investor inquiry', 'Book a call']);

export function keyForEmailType(type) {
  if (TYPE_TO_KEY[type]) return TYPE_TO_KEY[type];
  if (CATALOG[`site:${type}`]) return `site:${type}`;
  return 'site:One-off';
}
export function infoFor(key) {
  return CATALOG[key] || { label: String(key).replace(/^site:/, '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), group: 'team', about: 'An automation without a description yet.', href: '/automations' };
}

const WENT_OUT = new Set(['sent', 'delivered', 'read', 'opened', 'clicked', 'failed', 'bounced']);
const OPENED = new Set(['opened', 'clicked']);
const FAILED = new Set(['bounced', 'failed', 'complained', 'suppressed']);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);
const blankEmail = () => ({ sent: 0, opened: 0, clicked: 0, failed: 0, measured: 0 });
const blankWa = () => ({ sent: 0, delivered: 0, read: 0, failed: 0, clicked: 0 });
export const rateEmail = (b) => ({ ...b, openRate: pct(b.opened, b.measured), clickRate: pct(b.clicked, b.measured) });
export const rateWa = (b) => ({ ...b, readRate: pct(b.read, b.delivered), clickRate: pct(b.clicked, b.delivered) });

// logs: email_log rows { automation_id, channel, status, resend_id, subject, created_at } (team /
// test addresses already removed); resend: [{ id, subject, last_event, created_at }] (same);
// waClicks: [{ key, week: 'w'|'p'|null, inRange, n }] (people who tapped a WhatsApp button);
// range: days on the page. → { campaigns, totals: { email: { range, w, p }, wa: { range, w, p } } }
export function summarizeCampaigns({ logs = [], resend = [], waClicks = [], range = 30, now = Date.now() } = {}) {
  const resendById = new Map(resend.map((e) => [e.id, e]));
  const logged = new Set();
  const rows = new Map();
  const row = (key) => {
    if (!rows.has(key)) {
      rows.set(key, {
        key, ...infoFor(key), email: blankEmail(), wa: blankWa(),
        week: { email: { w: blankEmail(), p: blankEmail() }, wa: { w: blankWa(), p: blankWa() } },
        subjects: new Map(), lastAt: null,
      });
    }
    return rows.get(key);
  };
  const weekOf = (iso) => {
    const age = now - Date.parse(iso);
    return age < 7 * 86400000 ? 'w' : age < 14 * 86400000 ? 'p' : null;
  };
  const inRange = (iso) => now - Date.parse(iso) < range * 86400000;
  const note = (r, at, subject) => {
    if (inRange(at) && subject) r.subjects.set(subject, (r.subjects.get(subject) || 0) + 1);
    if (!r.lastAt || at > r.lastAt) r.lastAt = at;
  };
  const addEmail = (r, at, ev, subject, measurable) => {
    const parts = [];
    if (inRange(at)) parts.push(r.email);
    const wk = weekOf(at);
    if (wk) parts.push(r.week.email[wk]);
    for (const b of parts) {
      b.sent += 1;
      if (FAILED.has(ev)) b.failed += 1;
      if (measurable) { b.measured += 1; if (OPENED.has(ev)) b.opened += 1; if (ev === 'clicked') b.clicked += 1; }
    }
    note(r, at, subject);
  };

  for (const m of logs) {
    const id = m.automation_id;
    if (!id || SKIP_AUTOMATIONS.has(id) || m.channel === 'event' || m.channel === 'wa_campaign') continue;
    const st = String(m.status || '').toLowerCase();
    if (!WENT_OUT.has(st)) continue;
    const r = row(id);
    if (m.channel === 'whatsapp') {
      const parts = [];
      if (inRange(m.created_at)) parts.push(r.wa);
      const wk = weekOf(m.created_at);
      if (wk) parts.push(r.week.wa[wk]);
      for (const b of parts) {
        b.sent += 1;
        if (st === 'delivered' || st === 'read') b.delivered += 1;
        if (st === 'read') b.read += 1;
        if (st === 'failed') b.failed += 1;
      }
      const t = String(m.subject || '').replace(/^WhatsApp\s*·\s*/i, '');
      note(r, m.created_at, t ? `WhatsApp template: ${t}` : null);
      continue;
    }
    const e = m.resend_id ? resendById.get(m.resend_id) : null;
    if (m.resend_id) logged.add(m.resend_id);
    const ev = String(e?.last_event || (FAILED.has(st) ? st : 'sent')).toLowerCase();
    addEmail(r, m.created_at, ev, m.subject, !!e && !r.noRates);
  }

  for (const e of resend) {
    if (logged.has(e.id)) continue;
    const type = emailType(e.subject);
    if (SKIP_TYPES.has(type)) continue;
    const r = row(keyForEmailType(type));
    addEmail(r, e.created_at, String(e.last_event || 'sent').toLowerCase(), e.subject, !r.noRates);
  }

  for (const c of waClicks) {
    if (!c.key || !c.n || (!rows.has(c.key) && !CATALOG[c.key])) continue;
    const r = row(c.key);
    if (c.week === 'w' || c.week === 'p') r.week.wa[c.week].clicked += c.n;
    if (c.inRange) r.wa.clicked += c.n;
  }

  const campaigns = [...rows.values()]
    .filter((r) => r.email.sent || r.wa.sent || r.week.email.p.sent || r.week.wa.p.sent)
    .map((r) => ({
      ...r,
      email: rateEmail(r.email), wa: rateWa(r.wa),
      week: { email: { w: rateEmail(r.week.email.w), p: rateEmail(r.week.email.p) }, wa: { w: rateWa(r.week.wa.w), p: rateWa(r.week.wa.p) } },
      subjects: [...r.subjects.entries()].sort((a, b) => b[1] - a[1]).slice(0, r.key === 'site:One-off' ? 15 : 4).map(([subject, n]) => ({ subject, n })),
    }))
    .sort((a, b) => (b.email.sent + b.wa.sent) - (a.email.sent + a.wa.sent));

  // totals: campaigns only (site emails such as sign-in codes are not campaigns)
  const sum = (pick, blank, rate) => {
    const t = blank();
    for (const c of campaigns) {
      if (c.group === 'site') continue;
      const b = pick(c);
      for (const k of Object.keys(t)) t[k] += b[k] || 0;
    }
    return rate(t);
  };
  const totals = {
    email: { range: sum((c) => c.email, blankEmail, rateEmail), w: sum((c) => c.week.email.w, blankEmail, rateEmail), p: sum((c) => c.week.email.p, blankEmail, rateEmail) },
    wa: { range: sum((c) => c.wa, blankWa, rateWa), w: sum((c) => c.week.wa.w, blankWa, rateWa), p: sum((c) => c.week.wa.p, blankWa, rateWa) },
  };
  return { campaigns, totals };
}
