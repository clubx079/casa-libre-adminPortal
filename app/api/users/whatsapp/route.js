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
import { relay } from '@/lib/relayInbox';
import { translateToEnglish } from '@/lib/translate';
import { waLabel, waBodyText } from '@/lib/whatsappLabels';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = (s) => String(s).replace(/'/g, "''");

// Our approved templates' text (Relay), read every 10 minutes — for the English line.
let tplCache = null;
async function templateBodies() {
  if (tplCache && Date.now() - tplCache.at < 10 * 60 * 1000) return tplCache.map;
  const r = await relay('live', '/templates?status=all').catch(() => null);
  const map = new Map((r?.ok ? r.data.data || [] : []).map((t) => [t.name, t.body]));
  if (map.size) tplCache = { at: Date.now(), map };
  return map;
}

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
          WHERE event = '$pageview' AND properties.utm_source = 'whatsapp' AND properties.utm_medium = 'whatsapp'
            AND startsWith(coalesce(properties.utm_campaign, ''), 'cl_')
            AND lower(person.properties.email) = '${q(email)}'
            AND timestamp >= now() - INTERVAL 365 DAY
          GROUP BY t`);
        clicks = Object.fromEntries(res.map(([t, n]) => [String(t), Number(n) || 0]));
      } catch (e) { clicksNote = String(e?.message || e).slice(0, 120); }
    } else clicksNote = 'posthog_not_configured';
    const names = Object.fromEntries([...new Set(rows.map((r) => r.template_key).filter(Boolean))].map((k) => [k, englishTemplateName(k) || k]));
    const out = userWhatsApp(rows, clicks, names);
    // Like the email rows: an English name, the text they read (Spanish) and its English.
    const bodies = await templateBodies();
    const english = new Map();
    await Promise.all([...new Set(out.messages.map((m) => m.template))].map(async (t) => {
      const es = waBodyText(bodies.get(t));
      english.set(t, { es, en: es ? await translateToEnglish(es).catch(() => '') : '' });
    }));
    for (const m of out.messages) {
      const tx = english.get(m.template) || {};
      Object.assign(m, { type: waLabel(m.template), text: tx.es || '', text_en: tx.en && tx.en !== tx.es ? tx.en : '' });
    }
    return NextResponse.json({
      phone: user?.phone || null,
      verified: !!user?.phone_verified_at,
      optedOut: !!user?.whatsapp_opted_out_at,
      clicksNote,
      ...out,
    });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
