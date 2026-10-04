// GET /api/users/listings?email=…&userId=…  → the account behind a PostHog person
// and the properties it listed (read-only). Used by the user analytics page.
// The website identifies people in PostHog by their users.id, so userId is tried
// first, then the email.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { normalizeEmail, isDeletedEmail, listingSummary } from '@/lib/userInsights';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const USER_COLS = 'id,email,full_name,phone,auth_provider,created_at,last_login_at,ip_address,registration_ip,active';
const LISTING_COLS = 'id,address,city,neighborhood,price,currency,listing_type,property_type,admin_status,feature_image_url,created_at';
const UUID = /^[0-9a-f-]{16,40}$/i;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { select } = dbFor(activeCountry());
  const sp = new URL(req.url).searchParams;
  const userId = (sp.get('userId') || '').trim();
  const email = normalizeEmail(sp.get('email'));

  try {
    let user = null;
    if (UUID.test(userId)) [user] = await select('users', `select=${USER_COLS}&id=eq.${userId}&limit=1`);
    if (!user && email) [user] = await select('users', `select=${USER_COLS}&email=eq.${encodeURIComponent(email)}&limit=1`);
    if (!user || isDeletedEmail(user.email)) return NextResponse.json({ found: false, listings: [] });

    const rows = await select('properties', `select=${LISTING_COLS}&created_by=eq.${user.id}&order=created_at.desc&limit=50`);
    return NextResponse.json({
      found: true,
      user: {
        id: user.id, email: user.email, name: user.full_name || '', phone: user.phone || '',
        method: user.auth_provider === 'google' ? 'Google' : 'Email',
        joined: user.created_at, last_login: user.last_login_at,
        signup_ip: user.registration_ip || '', last_ip: user.ip_address || '',
      },
      listings: rows.map(listingSummary),
    });
  } catch (e) {
    console.error('[api/users/listings]', e);
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
