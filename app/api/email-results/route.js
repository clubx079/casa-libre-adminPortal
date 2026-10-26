// GET /api/email-results?days=30 → per automation: emails sent, clicked, people who landed on
// the site from them, and what those people did next (lib/emailResults.js). UTM Links page,
// "Automation emails" tab. Sources: email_log (the country's DB), Resend (clicks), PostHog
// (landings via the utm tags the buyer site adds to every email link).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { selectAll } from '@/lib/selectAll';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { UKEY, GEO_BASE } from '@/lib/posthogSql';
import { siteClause } from '@/lib/analyticsSite';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';
import { countryEmails } from '@/lib/resendEmails';
import { emailResults } from '@/lib/emailResults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const flat = (rows) => (rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));

// People who reached the site from an automation email, per automation, and what they did next.
async function landings(country, days) {
  if (!posthogConfigured()) return { rows: [], note: 'PostHog is not connected' };
  const W = `timestamp >= now() - INTERVAL ${days} DAY AND ${GEO_BASE}${siteClause(country)}`;
  const rows = flat(await hogql(`
    SELECT l.c AS campaign, count() AS people, sum(l.visits) AS visits,
           countIf(a.signed > 0) AS signedUp, countIf(a.listed > 0) AS listed, countIf(a.paid > 0) AS paid
    FROM (SELECT coalesce(properties.utm_campaign, '?') AS c, ${UKEY} AS k, count() AS visits
          FROM events WHERE event = '$pageview' AND properties.utm_source = 'email' AND properties.utm_medium = 'automation' AND ${W}
          GROUP BY c, k) AS l
    LEFT JOIN (SELECT ${UKEY} AS k, countIf(event IN ('user_signed_up', 'account_created')) AS signed,
                      countIf(event = 'listing_created') AS listed, countIf(event = 'payment_succeeded') AS paid
               FROM events WHERE ${W} GROUP BY k) AS a ON l.k = a.k
    GROUP BY campaign ORDER BY people DESC LIMIT 50`));
  return { rows: rows.map((r) => ({ campaign: r[0], people: Number(r[1]) || 0, visits: Number(r[2]) || 0, signedUp: Number(r[3]) || 0, listed: Number(r[4]) || 0, paid: Number(r[5]) || 0 })) };
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  const days = [7, 30, 90, 365].includes(Number(new URL(req.url).searchParams.get('days'))) ? Number(new URL(req.url).searchParams.get('days')) : 30;
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = dbFor(country);
  try {
    const [extra, logs, resend, land] = await Promise.all([
      internalEmails(country).catch(() => new Set()),
      selectAll(db, 'email_log', `select=automation_id,channel,status,to_email,resend_id&created_at=gte.${encodeURIComponent(since)}&automation_id=not.is.null&order=id.asc`),
      countryEmails(country, days).catch(() => null),
      landings(country, days).catch((e) => ({ rows: [], note: `PostHog: ${String(e?.message || e).slice(0, 120)}` })),
    ]);
    const mine = logs.filter((m) => !isInternalEmail(m.to_email, extra) && !['test', 'skipped'].includes(String(m.status)));
    const rows = emailResults({ logs: mine, resendEvent: new Map((resend?.rows || []).map((e) => [e.id, e.last_event])), landings: land.rows });
    return NextResponse.json({
      days, rows,
      notes: [
        resend ? null : 'Resend clicks are not readable (RESEND_READ_API_KEY).',
        land.note || null,
      ].filter(Boolean),
      taggedSince: '2026-10-26',
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: 500 });
  }
}
