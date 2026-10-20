// GET /api/analytics/verified — how many verified users of the ACTIVE country proved a
// WhatsApp number vs an email (the User analytics tab's one-line "Verified by").
// Team / test accounts left out. lib/userInsights.js verificationStats.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { selectAll } from '@/lib/selectAll';
import { HIDE_DELETED_USERS, verificationStats } from '@/lib/userInsights';
import { isInternalEmail } from '@/lib/internalTraffic';
import { internalEmails } from '@/lib/internalAudience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  try {
    const [users, extra] = await Promise.all([
      selectAll(dbFor(country), 'users', `select=id,email,verified,auth_provider,phone_verified_at&${HIDE_DELETED_USERS}&order=id.asc`),
      internalEmails(country),
    ]);
    const v = verificationStats(users.filter((u) => !isInternalEmail(u.email, extra)));
    return NextResponse.json({ whatsapp: v.whatsapp, email: v.email });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
