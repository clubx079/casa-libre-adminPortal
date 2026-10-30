// GET /api/users/paywall?userId=…&email=… → one person's paywall activity for their activity
// page: every time they wanted to publish one more listing than the free ones of the month,
// the payment came up, and what happened next (stopped / opened the card form / paid /
// free-listing gift offered / taken), plus their PostHog payment events (opened the pay screen,
// tapped Pay, paid, gift taken / failed). lib/paywallActivity.js. Read-only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { normalizeEmail } from '@/lib/userInsights';
import { paywallRows, paywallEvents, remindersByListing, STATE_LABEL, PAYMENT_EVENTS, posthogPaymentSteps, listingLabel } from '@/lib/paywallActivity';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { DELETED_EVENT, deletedListings, deletionEvent, goneListings } from '@/lib/listingDeletion';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f-]{16,40}$/i;
const q = (s) => String(s || '').replace(/'/g, "''");

// This person's payment events in PostHog (identified by their user id, or their email), 180 days.
async function posthogSteps(user, labelOf) {
  if (!posthogConfigured()) return { steps: [], posthog: 'not_configured' };
  try {
    const rows = await hogql(`SELECT timestamp, event, properties.property_id, properties.kind, properties.via, properties.reason
      FROM events WHERE event IN (${PAYMENT_EVENTS.map((e) => `'${e}'`).join(', ')})
        AND (distinct_id = '${q(user.id)}' OR person.properties.email = '${q(user.email)}')
        AND timestamp >= now() - INTERVAL 180 DAY
      ORDER BY timestamp DESC LIMIT 200`, { fresh: 60_000, stale: 0 });
    return { steps: posthogPaymentSteps(rows, labelOf), posthog: 'ok' };
  } catch { return { steps: [], posthog: 'error' }; }
}

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
    const [listings, deletedRows, ledger] = await Promise.all([
      select('properties', `select=id,created_by,created_at,status,raw_data,property_type,listing_type,neighborhood,city&created_by=eq.${user.id}&origin=eq.user&order=created_at.desc&limit=500`),
      select('email_log', `select=run_id,subject,error,created_at&automation_id=eq.${DELETED_EVENT}&to_email=eq.${encodeURIComponent(user.email)}&order=created_at.desc&limit=200`).catch(() => []),
      select('payments', `select=id,property_id,created_at&kind=eq.listing_free&user_id=eq.${user.id}&order=created_at.asc&limit=500`).catch(() => []),
    ]);
    const deleted = deletedListings(deletedRows);
    // deleted listings still count for "their Nth listing this month"
    const gone = goneListings({ userId: user.id, deleted, ledger });
    const walled = listings.filter((p) => p.raw_data?.paid_listing).map((p) => String(p.id));
    const [payments, logs] = walled.length ? await Promise.all([
      select('payments', `select=property_id,status,created_at&kind=eq.listing&status=eq.started&property_id=${inList(walled)}&order=created_at.asc`).catch(() => []),
      select('email_log', `select=dedupe_key&automation_id=in.(payment_followup,listing_held)&run_id=${inList(walled)}&status=in.(sent,delivered,read)`).catch(() => []),
    ]) : [[], []];
    const rows = paywallRows({ listings: [...listings, ...gone], payments, reminders: remindersByListing(logs), cc });
    const byId = new Map(listings.map((p) => [String(p.id), p]));
    const ph = await posthogSteps(user, (pid) => (byId.has(String(pid)) ? listingLabel(byId.get(String(pid))) : ''));
    // PostHog's "Tapped Pay" is the same moment as our "started" payment row: keep one.
    const ours = rows.flatMap(paywallEvents).filter((e) => !(e.kind === 'checkout' && ph.steps.some((x) => x.kind === 'ph_started')));
    return NextResponse.json({
      found: true,
      posthog: ph.posthog,
      rows: rows.map((r) => ({ ...r, label: STATE_LABEL[r.state] || r.state })),
      events: [...ours, ...ph.steps, ...deleted.map(deletionEvent)].sort((a, b) => String(b.at).localeCompare(String(a.at))),
    });
  } catch (e) {
    console.error('[api/users/paywall]', e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
