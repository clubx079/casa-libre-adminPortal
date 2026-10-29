// GET /api/inbox/contact?phone=&country= → the Casa Libre account behind a WhatsApp number
// (lib/inboxContact.js): name, listings, link to their activity page. null when unknown.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { canAccessCountry } from '@/lib/adminCountry';
import { contactFor } from '@/lib/inboxContact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const country = String(sp.get('country') || '').toLowerCase();
  if (!/^[a-z]{2,5}$/.test(country) || !canAccessCountry(country)) return NextResponse.json({ contact: null });
  try { return NextResponse.json({ contact: await contactFor(sp.get('phone'), country) }); }
  catch (e) { return NextResponse.json({ contact: null, error: String(e?.message || e).slice(0, 200) }); }
}
