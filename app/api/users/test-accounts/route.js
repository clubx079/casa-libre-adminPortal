// POST /api/users/test-accounts { email, test: true|false } — mark an account of the ACTIVE
// country as a test / review account (or undo it). Marked accounts are hidden from every admin
// list and left out of every count and percentage (lib/testAccounts.js → lib/internalAudience.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { setMarked } from '@/lib/testAccounts';
import { forgetInternal } from '@/lib/internalAudience';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  const me = getSession();
  if (!me) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || '').trim().toLowerCase();
  if (!email.includes('@')) return NextResponse.json({ error: 'This account has no email, so it cannot be marked.' }, { status: 400 });
  const cc = activeCountry();
  try {
    await setMarked(dbFor(cc), email, body.test !== false, me.email || me.name || null);
    forgetInternal(cc);
    return NextResponse.json({ ok: true, email, test: body.test !== false });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
