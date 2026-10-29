// GET /api/users/paywall?userId=…&email=… → one person's paywall activity for their activity
// page: every time they wanted to publish one more listing than the free ones of the month,
// the payment came up, and what happened next (stopped / opened the card form / paid /
// free-listing gift offered / taken). lib/paywallActivity.js. Read-only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { normalizeEmail } from '@/lib/userInsights';
import { paywallRows, paywallEvents, remindersByListing, STATE_LABEL } from '@/lib/paywallActivity';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{16,40}$/i;
const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const cc = activeCountry();
  const { select } = dbFor(cc);
  const sp = new URL(req.url).searchParams;
  const userId = (sp.get('userId') || '').trim();
  const email = normalizeEmail(sp.get('email'));
  try {
    let user = null;
    if (UUID.test(userId)) [user] = await select('users', `select=id,email&id=eq.${userId}&limit=1`);
    if (!user && email) [user] = await select('users', `select=id,email&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (!user) return NextResponse.json({ found: false, rows: [], events: [] });
    const listings = await select('properties', `select=id,created_by,created_at,status,raw_data,property_type,listing_type,neighborhood,city&created_by=eq.${user.id}&origin=eq.user&order=created_at.desc&limit=500`);
    const walled = listings.filter((p) => p.raw_data?.paid_listing).map((p) => String(p.id));
    const [payments, logs] = walled.length ? await Promise.all([
      select('payments', `select=property_id,status,created_at&kind=eq.listing&status=eq.started&property_id=${inList(walled)}&order=created_at.asc`).catch(() => []),
      select('email_log', `select=dedupe_key&automation_id=in.(payment_followup,listing_held)&run_id=${inList(walled)}&status=in.(sent,delivered,read)`).catch(() => []),
    ]) : [[], []];
    const rows = paywallRows({ listings, payments, reminders: remindersByListing(logs), cc });
    return NextResponse.json({
      found: true,
      rows: rows.map((r) => ({ ...r, label: STATE_LABEL[r.state] || r.state })),
      events: rows.flatMap(paywallEvents).sort((a, b) => String(b.at).localeCompare(String(a.at))),
    });
  } catch (e) {
    console.error('[api/users/paywall]', e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
