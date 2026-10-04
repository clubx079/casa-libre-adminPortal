import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { hogql, posthogConfigured } from '@/lib/posthogHogql';
import { clickSql, applyClicks, fillSellers, OPEN_TRACKING_GAP } from '@/lib/contactsReport';
import { isInternalContact } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/contacts -> contacts from listings (who contacted which seller about which
// property, and whether the seller opened the link), newest first. Buyers who weren't
// signed in are filled in from PostHog when they signed in later (lib/contactsReport).
// `gap`: when this country's contact links couldn't record an open.
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const country = activeCountry();
  const { select } = dbFor(country);
  const gap = OPEN_TRACKING_GAP[country] || null;
  let rows;
  try {
    rows = await select('contact_link_clicks', 'select=*&order=created_at.desc&limit=1000');
  } catch (e) {
    const msg = String(e?.message || e);
    // Table not registered yet (migration/schema-cache pending) → render empty
    // instead of a 500 that breaks the page.
    if (/does not exist|PGRST205|schema cache|not find the table/i.test(msg)) return NextResponse.json({ rows: [], pending: true, gap });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  // Seller details from the listing (+ the owner's account email for listings a
  // Casa Libre user published). Best effort: a failure keeps what the rows saved.
  try {
    const ids = [...new Set(rows.map((r) => r.property_id).filter((v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))))];
    const props = [];
    for (let i = 0; i < ids.length; i += 100) {
      props.push(...await select('properties', `select=id,contact_name,contact_phone,created_by&id=in.(${ids.slice(i, i + 100).join(',')})`));
    }
    const owners = [...new Set(props.map((p) => p.created_by).filter((v) => /^[0-9a-f-]{36}$/i.test(String(v || ''))))];
    const users = owners.length ? await select('users', `select=id,email,full_name&id=in.(${owners.join(',')})`) : [];
    rows = fillSellers(rows, props, users);
  } catch (e) { console.error('[api/contacts] sellers', e?.message || e); }
  // Who + where from the PostHog click behind each contact (buyers who signed in later,
  // IP / location when the website didn't save one). Best effort: PostHog being slow or
  // down must not hide the contacts.
  const sql = posthogConfigured() ? clickSql(rows) : null;
  if (sql) {
    try { rows = applyClicks(rows, await hogql(sql)); } catch (e) { console.error('[api/contacts] posthog clicks', e?.message || e); }
  }
  // Our own team's contacts (by name / email, or made from the dev team's country)
  // never show — now or in future (lib/internalTraffic.js).
  const extra = await internalEmails(country).catch(() => null);
  rows = rows.filter((r) => !isInternalContact(r, extra));
  return NextResponse.json({ rows, gap });
}
