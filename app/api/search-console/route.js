// GET /api/search-console?days=7|28|90 — Google Search Console for the active country's site
// (lib/searchConsole.js overview): clicks, impressions, CTR, position, daily series, top keywords,
// top pages, devices, countries, sitemaps. Read-only. No access → { access: false }.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { overview } from '@/lib/searchConsole';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cache = new Map(); // `${cc}:${days}` -> { at, data }

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const d = Number(new URL(req.url).searchParams.get('days'));
  const days = [7, 28, 90].includes(d) ? d : 28;
  const key = `${cc}:${days}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 30 * 60_000) return NextResponse.json(hit.data);
  try {
    const data = await overview(cc, days);
    cache.set(key, { at: Date.now(), data });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e), country: cc }, { status: 502 });
  }
}
