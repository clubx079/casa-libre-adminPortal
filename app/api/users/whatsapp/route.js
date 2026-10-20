// GET /api/users/whatsapp?email=… — every WhatsApp message the automations sent this
// person (email_log channel 'whatsapp', by their email or their number), its status from
// Relay's webhook (sent / delivered / read / failed), and their clicks on the buttons
// (PostHog visits with utm_source=whatsapp). Read-only. lib/userWhatsApp.js.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { normalizeEmail } from '@/lib/userInsights';
import { englishTemplateName } from '@/lib/userEmails';
import { userWhatsApp } from '@/lib/userWhatsApp';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = (s) => String(s).replace(/'/g, "''");

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const email = normalizeEmail(new URL(req.url).searchParams.get('email'));
  if (!email) return NextResponse.json({ error: 'bad_email' }, { status: 400 });
  const { select } = dbFor(activeCountry());
  try {
    const [user] = await select('users', `select=id,phone,phone_verified_at,whatsapp_opted_out_at&email=eq.${encodeURIComponent(email)}&limit=1`).catch(() => []);
    const or = [`to_email.eq.${email}`, ...(user?.phone ? [`to_phone.eq.${user.phone}`] : [])].map(encodeURIComponent).join(',');
    const rows = await select('email_log', `select=id,status,subject,template_key,to_phone,created_at&channel=eq.whatsapp&or=(${or})&order=created_at.desc&limit=200`).catch(() => []);
    let clicks = {};
    let clicksNote = null;
    if (posthogConfigured()) {
      try {
        const res = await hogql(`
          SELECT coalesce(properties.utm_campaign, 'other') AS t, count() AS n
          FROM events
          WHERE event = '$pageview' AND properties.utm_source = 'whatsapp'
            AND lower(person.properties.email) = '${q(email)}'
            AND timestamp >= now() - INTERVAL 365 DAY
          GROUP BY t`);
        clicks = Object.fromEntries(res.map(([t, n]) => [String(t), Number(n) || 0]));
      } catch (e) { clicksNote = String(e?.message || e).slice(0, 120); }
    } else clicksNote = 'posthog_not_configured';
    const names = Object.fromEntries([...new Set(rows.map((r) => r.template_key).filter(Boolean))].map((k) => [k, englishTemplateName(k) || k]));
    return NextResponse.json({
      phone: user?.phone || null,
      verified: !!user?.phone_verified_at,
      optedOut: !!user?.whatsapp_opted_out_at,
      clicksNote,
      ...userWhatsApp(rows, clicks, names),
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
