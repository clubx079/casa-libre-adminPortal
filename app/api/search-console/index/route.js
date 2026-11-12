// GET  /api/search-console/index — the last index check for the active country (cached 12 h) or null
// POST /api/search-console/index — run it now: Google's URL Inspection API on a random sample of the
//   site's sitemap pages (lib/searchConsole.js indexCheck). Google gives no "indexed pages" total
//   through any API, so the page shows an estimate: indexed share of the sample × pages in the sitemap.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { indexCheck } from '@/lib/searchConsole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try {
    return NextResponse.json(await indexCheck(cc, 40, { force: true }));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e), country: cc }, { status: 502 });
  }
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try {
    return NextResponse.json(await indexCheck(cc, 40));
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e), country: cc }, { status: 502 });
  }
}
