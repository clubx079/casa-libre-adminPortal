// GET /api/users/activity?email=…&userId=…  → one person's chat and team activity for the
// "Messages & activity" timeline (Analytics → a user), in ENGLISH. Read-only.
//   • their WhatsApp chat (Relay, the number the Inbox works on: inboxMode())
//   • the Inbox AI's replies and hand-overs (email_log 'inbox_ai' / 'inbox_ai_person')
//   • the Admin Manager (email_log 'manager' / 'manager_views' / 'open_issue')
//   • their feedback (table feedback)
//   • clicks on the AI's tracked links (PostHog link_click, slug 'ai', recipient = aiRef(phone))
// The person is matched by their account phone (last 8 digits, like the Inbox) and email.
// The card merges this with /api/users/emails, /whatsapp and /paywall (lib/userTimeline.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { normalizeEmail } from '@/lib/userInsights';
import { relay, inboxMode, phoneParam } from '@/lib/relayInbox';
import { phoneKey } from '@/lib/inboxRules';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { toEnglishMany } from '@/lib/issueTranslate';
import { aiRef } from '@/lib/aiLinks';
import { AI_IDS, MANAGER_IDS, REPLY_IDS, activityTimeline, textsToTranslate, chatLink } from '@/lib/userTimeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const enc = encodeURIComponent;
const UUID = /^[0-9a-f-]{16,40}$/i;
const SAFE_REF = /^[a-z0-9]{1,16}$/;
const LOG_COLS = 'id,automation_id,template_key,channel,to_email,to_phone,subject,status,resend_id,relay_message_id,run_id,error,created_at';
const within = (p, ms, fallback) => Promise.race([p, new Promise((resolve) => setTimeout(() => resolve(fallback), ms))]);

// link_click on the AI's links for this person → [{ answer, path, at, n }] (silently [] without PostHog)
async function aiClicks(phone) {
  const ref = aiRef(phone);
  if (!SAFE_REF.test(ref) || !posthogConfigured()) return { clicks: [], note: posthogConfigured() ? null : 'posthog_not_configured' };
  try {
    // grouped by aliases (GROUP BY on the coalesce(...) itself came back empty — lib/waCampaignClicks.js)
    const rows = await hogql(`SELECT coalesce(toString(properties.answer), '') AS a, coalesce(toString(properties.path), '') AS p, min(timestamp) AS first, count() AS n
      FROM events WHERE event = 'link_click' AND properties.slug = 'ai' AND properties.recipient = '${ref}' AND timestamp >= now() - INTERVAL 365 DAY
      GROUP BY a, p ORDER BY first DESC LIMIT 200`, { fresh: 60_000, stale: 0 });
    return { clicks: (rows || []).map(([answer, path, at, n]) => ({ answer: String(answer || ''), path: String(path || ''), at: String(at || '').replace(' ', 'T'), n: Number(n) || 1 })), note: null };
  } catch (e) {
    return { clicks: [], note: String(e?.message || e).slice(0, 120) };
  }
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const email = normalizeEmail(sp.get('email'));
  const userId = String(sp.get('userId') || '').trim();
  if (!email && !UUID.test(userId)) return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  const { select } = dbFor(activeCountry());
  const mode = inboxMode();

  try {
    let user = null;
    if (UUID.test(userId)) [user] = await select('users', `select=id,email,phone&id=eq.${userId}&limit=1`).catch(() => []);
    if (!user && email) [user] = await select('users', `select=id,email,phone&email=eq.${enc(email)}&limit=1`).catch(() => []);
    const mail = normalizeEmail(user?.email) || email;
    const digits = String(user?.phone || '').replace(/\D/g, '');
    const key = digits.length >= 8 ? phoneKey(digits) : '';

    // email_log by their email or their number (last 8 digits, as the Inbox matches people)
    const who = [mail && `to_email.eq.${mail}`, key && `to_phone.like.%${key}`].filter(Boolean).map(enc).join(',');
    const ids = [...AI_IDS, ...MANAGER_IDS, ...REPLY_IDS].join(',');
    const [logRows, waLinks, feedback, chat, clickRes] = await Promise.all([
      who ? select('email_log', `select=${LOG_COLS}&automation_id=in.(${ids})&or=(${who})&order=created_at.desc&limit=300`).catch(() => []) : [],
      // their WhatsApp automation rows (the WhatsApp card) → the Relay message each one is
      who ? select('email_log', `select=id,relay_message_id&channel=eq.whatsapp&relay_message_id=not.is.null&or=(${who})&order=created_at.desc&limit=300`).catch(() => []) : [],
      (user?.id || mail)
        ? select('feedback', `select=id,user_id,email,rating,message,source,created_at&or=(${[user?.id && `user_id.eq.${user.id}`, mail && `email.eq.${mail}`].filter(Boolean).map(enc).join(',')})&order=created_at.desc&limit=50`).catch(() => [])
        : [],
      digits.length >= 8 ? relay(mode, `/conversations/${phoneParam(digits)}/messages?limit=100`).catch((e) => ({ ok: false, status: 0, data: { error: { message: String(e?.message || e) } } })) : null,
      digits.length >= 8 ? aiClicks(digits) : { clicks: [], note: null },
    ]);
    const messages = chat?.ok ? (Array.isArray(chat.data?.data) ? chat.data.data : Array.isArray(chat.data) ? chat.data : []) : [];
    const chatNote = !digits ? 'no_phone' : chat && !chat.ok ? (chat.status === 404 ? 'no_chat' : chat.data?.error?.code || `relay_${chat.status}`) : null;
    // their own rows only (the last-8 match can catch another country's number with the same tail)
    const rows = logRows.filter((r) => (mail && String(r.to_email || '').toLowerCase() === mail) || (key && phoneKey(r.to_phone) === key));

    const texts = textsToTranslate({ messages, logRows: rows, feedback }).slice(0, 200);
    const english = texts.length ? await within(toEnglishMany(texts).catch(() => new Map()), 25_000, new Map()) : new Map();
    const items = activityTimeline({ messages, logRows: rows, feedback, clicks: clickRes.clicks, english });

    return NextResponse.json({
      phone: digits ? `+${digits}` : null,
      mode,
      chatUrl: digits ? chatLink(digits, mode) : null,
      chatNote,
      clicksNote: clickRes.note,
      translated: english.size > 0,
      relayOf: Object.fromEntries(waLinks.filter((r) => r.relay_message_id).map((r) => [r.id, r.relay_message_id])),
      items,
    });
  } catch (e) {
    console.error('[api/users/activity]', e);
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
