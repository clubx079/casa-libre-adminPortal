// GET /api/analytics/whatsapp?days=7 — WhatsApp for the ACTIVE country, like the Email
// analytics: messages the site's automations sent (email_log channel 'whatsapp', status
// from Relay's webhook), clicks on their buttons (PostHog visits with utm_source=whatsapp)
// and how users verify — WhatsApp vs email (lib/userInsights.js + lib/whatsappMessageStats.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { selectAll } from '@/lib/selectAll';
import { summarizeWhatsApp, verificationsInPeriod } from '@/lib/whatsappMessageStats';
import { HIDE_DELETED_USERS, verificationStats } from '@/lib/userInsights';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { siteClause } from '@/lib/analyticsSite';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  const db = dbFor(country);
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('days') || '7', 10) || 7, 1), 365);
  const since = new Date(Date.now() - days * 86400000).toISOString();

  try {
    const [rows, users, extra] = await Promise.all([
      selectAll(db, 'email_log', `select=id,status,subject,to_email,to_phone,created_at&channel=eq.whatsapp&created_at=gte.${encodeURIComponent(since)}&order=id.asc`).catch(() => []),
      selectAll(db, 'users', `select=id,email,verified,auth_provider,phone_verified_at,created_at&${HIDE_DELETED_USERS}&order=id.asc`).catch(() => []),
      internalEmails(country),
    ]);
    const real = users.filter((u) => !isInternalEmail(u.email, extra));
    const mine = rows.filter((r) => !isInternalEmail(r.to_email, extra));

    // Clicks per template, from PostHog (button links carry utm_source=whatsapp).
    let clicks = {};
    let clicksNote = null;
    if (posthogConfigured()) {
      try {
        const res = await hogql(`
          SELECT coalesce(properties.utm_campaign, 'other') AS t, count() AS n
          FROM events
          WHERE event = '$pageview' AND properties.utm_source = 'whatsapp'
            AND timestamp >= now() - INTERVAL ${days} DAY${siteClause(country)}
          GROUP BY t`);
        clicks = Object.fromEntries(res.map(([t, n]) => [String(t), Number(n) || 0]));
      } catch (e) { clicksNote = String(e?.message || e).slice(0, 120); }
    } else clicksNote = 'posthog_not_configured';

    return NextResponse.json({
      country, days, since,
      hidden: rows.length - mine.length,
      ...summarizeWhatsApp(mine, clicks),
      clicksNote,
      verifiedBy: verificationStats(real),
      newInPeriod: verificationsInPeriod(real, since),
      recent: mine.slice(-25).reverse().map((r) => ({ id: r.id, to: r.to_phone, template: String(r.subject || '').replace(/^WhatsApp\s*·\s*/i, ''), status: r.status, at: r.created_at })),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
