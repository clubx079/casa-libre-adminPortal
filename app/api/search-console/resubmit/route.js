// POST /api/search-console/resubmit?cc=py — resubmit one country's sitemap to Google
// (lib/searchConsole.js resubmitSitemap). The page calls it once per country, so it can show
// progress. Needs the Search Console write scope; without it → { needsReconnect: true }.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { resubmitSitemap, GSC_SITES } from '@/lib/searchConsole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = String(new URL(req.url).searchParams.get('cc') || '').toLowerCase();
  if (!GSC_SITES[cc]) return NextResponse.json({ error: 'unknown country' }, { status: 400 });
  try {
    return NextResponse.json(await resubmitSitemap(cc));
  } catch (e) {
    return NextResponse.json({ cc, ok: false, error: String(e.message || e) }, { status: 502 });
  }
}
