// Open issues — what the team can do with one (the Approve buttons). Every action works on an
// issue the server built itself (lib/openIssuesStore.js), so a click can only touch that
// issue's person and listings. Each is logged in the country's email_log (automation
// 'open_issue') and the issue's state is saved (done / dismissed / sent / gift / kept / lifted).
//   send_whatsapp   free text in the open 24 h window (Relay; 422 when it closed)
//   send_email      a personal email from hola@<site> (MANAGER_SEND_TO redirects it locally)
//   publish_free    the listings waiting for payment go live as a gift: same record as the
//                   website's gift claim (raw_data.paid_listing.gift, by: admin) → status
//                   'scanning' → the website's photo check publishes them (within the hour)
//   keep_suspended / lift_suspension   the security watch's suspensions
//   done / dismiss  closes it (with an optional note)
// Server only.
import 'server-only';
import { dbFor } from './db';
import { relay, inboxMode } from './relayInbox';
import { sendManagerEmail } from './email';
import { countryInfo } from './automationAdmin';
import { loadIssues, writeState, forgetIssues } from './openIssuesStore';
import { reviewSuspension } from './securityWatch';
import { toCustomerLanguage } from './issueTranslate';

const D = 86400000;
const enc = encodeURIComponent;
const esc = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
export const SUBJECTS = {
  payment: 'Publicamos tus propiedades en Casa-Libre',
  views: 'Tu publicación en Casa-Libre',
  funnel: 'Tu publicación en Casa-Libre',
  keyword: 'Casa-Libre',
  unanswered: 'Casa-Libre',
};

async function log(db, issue, by, kind, extra = {}) {
  await db.insert('email_log', [{
    automation_id: 'open_issue', channel: kind === 'whatsapp' ? 'whatsapp' : 'email', to_email: issue.person?.email || '', to_phone: issue.person?.phone || null,
    subject: issue.title.slice(0, 200), status: extra.status || 'sent', relay_message_id: extra.relayId || null,
    error: JSON.stringify({ issue: issue.id, type: issue.type, action: kind, by, ...extra.meta }),
  }], { returning: 'minimal' }).catch(() => {});
}

// Publish the waiting listings free (Roland: "we've comped your listings, they're now live").
export async function publishFree(db, propertyIds, { by, giftDays = 90, now = new Date() } = {}) {
  const at = now.toISOString();
  const done = [];
  for (const id of propertyIds) {
    const [p] = await db.select('properties', `select=id,status,raw_data&id=eq.${enc(id)}&limit=1`);
    if (!p || p.status !== 'payment_pending') continue;
    const info = p.raw_data?.paid_listing && typeof p.raw_data.paid_listing === 'object' ? p.raw_data.paid_listing : {};
    const raw = {
      ...(p.raw_data || {}),
      paid_listing: { ...info, state: 'active', until: new Date(now.getTime() + giftDays * D).toISOString(), gift: { ...(info.gift || {}), offered_at: info.gift?.offered_at || at, claimed_at: at, by: `admin:${by}`, source: 'open_issues' }, reminded_for: null },
      moderation: { ...(p.raw_data?.moderation || {}), state: 'scanning', started_at: at },
    };
    const r = await db.update('properties', `id=eq.${enc(p.id)}&status=eq.payment_pending`, { status: 'scanning', raw_data: raw }, { returning: 'representation' });
    if (Array.isArray(r) && r.length) done.push(p.id);
  }
  return done;
}

// Ask the website to run its photo check now (best effort; otherwise its hourly cron does it).
// Only when WEBSITE_CRON_SECRET (the website's CRON_SECRET) is set — never from a local test.
async function kickScan(country) {
  const secret = process.env.WEBSITE_CRON_SECRET;
  if (!secret) return false;
  try {
    const r = await fetch(`${countryInfo(country).site}/api/cron/image-scan`, { method: 'POST', headers: { Authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(8000) });
    return r.ok;
  } catch { return false; }
}

// → { ok, issue?, error?, ... }
export async function runIssueAction(country, { id, action, text = '', subject = '', note = '', lang = '' }, session) {
  const by = session?.email || session?.name || 'admin';
  const db = dbFor(country);
  const { issues, giftDays } = await loadIssues(country);
  const issue = issues.find((i) => i.id === id);
  if (!issue) return { ok: false, error: 'This issue is no longer open (refresh the list).' };
  if (!issue.actions.includes(action) && !['done', 'dismiss'].includes(action)) return { ok: false, error: 'not_allowed' };
  let body = String(text || '').trim().slice(0, 4000);
  const result = { ok: true };
  // the team writes in English; the person gets it in their own language (Spanish with vos in Paraguay)
  let english = null;
  if (lang === 'en' && body && (action === 'send_whatsapp' || action === 'send_email')) {
    const tr = await toCustomerLanguage(body, issue.data?.sample || '');
    if (tr.error) return { ok: false, error: tr.error };
    english = body;
    body = tr.text;
    result.sentText = body;
  }

  if (action === 'send_whatsapp') {
    if (!body) return { ok: false, error: 'Write the message first.' };
    if (!issue.person?.phone) return { ok: false, error: 'No WhatsApp number.' };
    const r = await relay(inboxMode(), '/messages/text', { method: 'POST', json: { to: issue.person.phone, text: body, metadata: { agent: by, source: 'open_issue', issue: issue.id } } });
    if (!r.ok) return { ok: false, error: r.status === 422 ? 'The 24-hour window closed: send a template from the Inbox, or email them.' : r.data?.error?.message || `Relay ${r.status}` };
    await log(db, issue, by, 'whatsapp', { relayId: r.data?.id || null, meta: { text: body.slice(0, 1500), ...(english ? { english: english.slice(0, 1500) } : {}) } });
    await writeState(db, issue.id, { state: issue.type === 'payment' && !issue.followup ? 'open' : 'sent', by, sent: 'whatsapp' });
  } else if (action === 'send_email') {
    if (!body) return { ok: false, error: 'Write the message first.' };
    if (!issue.person?.email) return { ok: false, error: 'No email address.' };
    const subj = String(subject || SUBJECTS[issue.type] || 'Casa-Libre').slice(0, 150);
    const r = await sendManagerEmail({ country, to: issue.person.email, subject: subj, text: body, html: `<p>${esc(body).replace(/\n/g, '<br>')}</p>` });
    if (!r.ok) return { ok: false, error: r.error || 'The email could not be sent.' };
    await log(db, issue, by, 'email', { meta: { subject: subj, text: body.slice(0, 1500), ...(english ? { english: english.slice(0, 1500) } : {}), redirected: r.redirected || false } });
    await writeState(db, issue.id, { state: issue.type === 'payment' && !issue.followup ? 'open' : 'sent', by, sent: 'email' });
    result.redirectedTo = r.redirected ? r.to : null;
  } else if (action === 'publish_free') {
    const done = await publishFree(db, issue.data?.propertyIds || [], { by, giftDays });
    if (!done.length) return { ok: false, error: 'Nothing to publish: the listings are no longer waiting for payment.' };
    await log(db, issue, by, 'gift', { status: 'sent', meta: { properties: done, gift_days: giftDays } });
    // the card stays as "send the thank-you" (lib/openIssues.js) until a message goes out
    await writeState(db, issue.id, { state: 'gift', by, published: done, snapshot: { person: issue.person, draft: issue.draft, evidence: issue.evidence.slice(0, 2), windowOpen: !!issue.data?.windowOpen } });
    result.published = done;
    result.scanStarted = await kickScan(country);
  } else if (action === 'keep_suspended' || action === 'lift_suspension') {
    await reviewSuspension(db, issue.person.userId, { lift: action === 'lift_suspension', by });
    await writeState(db, issue.id, { state: action === 'lift_suspension' ? 'lifted' : 'kept', by });
  } else if (action === 'done' || action === 'dismiss') {
    await writeState(db, issue.id, { state: action === 'done' ? 'done' : 'dismissed', by, note: String(note || '').slice(0, 300) || null });
  } else return { ok: false, error: 'unknown_action' };

  forgetIssues(country);
  return result;
}
