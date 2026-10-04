// GET /api/analytics/emails?days=30 — emails sent through Resend by the ACTIVE
// country's site, and what happened to them. Reads Resend's "List sent emails" API
// directly (no database): needs a FULL-ACCESS key in RESEND_READ_API_KEY (the sites'
// own keys are send-only and cannot list). Fetching + the 5-minute cache live in
// lib/resendEmails.js (shared with the user page's Emails card).
//
// Left out: emails to the team / Pakistan / test addresses (lib/internalTraffic +
// internalAudience), and team notifications ("Book a call", investor inquiries) and
// admin test sends (HIDDEN_EMAIL_TYPES). Opened / clicked count only emails sent while open tracking
// was on, without sign-in codes (lib/emailStats summarize).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { summarize, emailType, trackingFor } from '@/lib/emailStats';
import { countryEmails } from '@/lib/resendEmails';
import { isInternalEmail, HIDDEN_EMAIL_TYPES } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const recipients = (e) => (Array.isArray(e.to) ? e.to : [e.to]).map((x) => String(x || '').toLowerCase());

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!process.env.RESEND_READ_API_KEY) return NextResponse.json({ error: 'no_key' }, { status: 200 });

  const country = activeCountry();
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('days') || '30', 10) || 30, 1), 365);

  try {
    const [{ domain, rows, truncated }, extra] = await Promise.all([countryEmails(country, days), internalEmails(country)]);
    const internal = (e) => HIDDEN_EMAIL_TYPES.includes(emailType(e.subject)) || recipients(e).some((x) => isInternalEmail(x, extra));
    const mine = rows.filter((e) => !internal(e));
    const tracking = trackingFor(country);
    return NextResponse.json({
      country, domain, days, truncated,
      hidden: rows.length - mine.length,
      trackingSince: tracking.since,
      ...summarize(mine, { trackingSince: tracking.since }),
      recent: mine.slice(0, 25).map((e) => ({
        id: e.id,
        to: recipients(e).join(', '),
        type: emailType(e.subject),
        subject: e.subject,
        status: e.last_event || 'sent',
        at: e.created_at,
      })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
