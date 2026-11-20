// GET /api/seo-sites/feed?site=<domain | key> — what one of the six SEO sites shows from the AI SEO
// pipeline (contract: SEO_SITES_SPEC.md): its published pipeline guides (site guide format) and the
// title / H1 / description / extra-link overrides of its pages.
//   Authorization: Bearer SEO_PUBLISH_SECRET (the sites call it server-side; no admin session — the path
//   is public in middleware.js + lib/adminPages.js ALWAYS_API, and this secret is the gate)
//   200 { site, updatedAt, guides: [...], overrides: [{ path, title, h1, description, extraLinks }] }
//   401 without the secret · 404 unknown site. Cached 60 s in memory (lib/seoSites/feedCache.js); never throws.
import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { siteFor } from '@/lib/seoSites/scope';
import { getFeed } from '@/lib/seoSites/feedCache';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function authorized(req) {
  const secret = process.env.SEO_PUBLISH_SECRET || '';
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!secret || !token) return false;
  const a = Buffer.from(token); const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(req) {
  try {
    if (!authorized(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    const site = siteFor(new URL(req.url).searchParams.get('site'));
    if (!site) return NextResponse.json({ error: 'unknown site' }, { status: 404 });
    const feed = await getFeed(site);
    return NextResponse.json(feed, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return NextResponse.json({ site: null, updatedAt: new Date().toISOString(), guides: [], overrides: [], error: 'feed error' });
  }
}
