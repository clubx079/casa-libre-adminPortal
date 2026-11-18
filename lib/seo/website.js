// Stage 6 — Publish: tell the country website that SEO data changed. The site re-reads seo_overrides
// and seo_drafts at once (cache tag 'seo') and pings Bing IndexNow for the changed URLs (skipped when
// the site runs on localhost). Best-effort: the change is already saved and goes live within 5
// minutes anyway (the website's cache revalidates every 300 s). Server-only.
//   SEO_WEBSITE_URL_<CC>  the site to call (default: the country's public domain)
//   SEO_PUBLISH_SECRET    shared with the website (falls back to CRON_SECRET)
import 'server-only';
import { siteFor } from './places.js';

export const websiteUrl = (cc) => (process.env[`SEO_WEBSITE_URL_${cc.toUpperCase()}`] || siteFor(cc)).replace(/\/$/, '');

// Batch mode (Autopilot): while a country's batch is open, changes only queue their URLs; one call at
// the end tells the website (one cache refresh + one IndexNow ping instead of one per change).
const batches = new Map();   // cc → { urls: Set, indexNow }
export function startBatch(cc) { batches.set(cc, { urls: new Set(), indexNow: false }); }
export async function flushBatch(cc) {
  const b = batches.get(cc);
  batches.delete(cc);
  if (!b || !b.urls.size) return { ok: true, skipped: 'nothing changed' };
  return notifyWebsite(cc, [...b.urls], { indexNow: b.indexNow });
}

export async function notifyWebsite(cc, urls = [], { indexNow = true } = {}) {
  const b = batches.get(cc);
  if (b) { for (const u of urls) if (u) b.urls.add(u); b.indexNow ||= indexNow; return { ok: true, queued: true }; }
  const secret = process.env.SEO_PUBLISH_SECRET || process.env.CRON_SECRET;
  if (!secret) return { ok: false, skipped: 'no SEO_PUBLISH_SECRET' };
  try {
    const r = await fetch(`${websiteUrl(cc)}/api/seo/publish`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
      body: JSON.stringify({ urls: urls.filter(Boolean), indexNow }), cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, ...j };
  } catch (e) {
    return { ok: false, error: String(e?.message || e).slice(0, 200) };
  }
}
