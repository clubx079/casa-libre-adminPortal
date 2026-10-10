import { getSession } from '@/lib/auth';
import { NextResponse } from 'next/server';
import { ipGeo } from '@/lib/ipGeo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// IP -> city/state/country via ip-api.com (lib/ipGeo.js: every IP looked up once,
// in batches of 100, and remembered — shared with the Pakistan-account check).
// Mirrors the DeelMap admin's users/geo-lookup implementation.

// POST { ips: [...] } -> { ip: { city, state, country } }
export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  let ips = [];
  try { ips = (await req.json())?.ips || []; } catch {}
  return NextResponse.json(await ipGeo(Array.isArray(ips) ? ips : []));
}
