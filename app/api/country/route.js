import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { setActiveCountryCookie, canAccessCountry } from '@/lib/adminCountry';
import { listCountries } from '@/lib/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { code } — switch the admin's active country (validated against the registry).
export async function POST(request) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  let code = '';
  try { const b = await request.json(); code = String(b.code || '').toLowerCase(); } catch {}
  const countries = await listCountries();
  if (!countries.find((c) => c.code === code)) {
    return NextResponse.json({ error: 'unknown_country' }, { status: 400 });
  }
  // Server-side access check: an admin can't switch to a country they lack.
  if (!canAccessCountry(code)) {
    return NextResponse.json({ error: 'forbidden_country' }, { status: 403 });
  }
  setActiveCountryCookie(code);
  return NextResponse.json({ ok: true, code });
}
