// Clicks per WhatsApp campaign batch. WhatsApp never tells the business that a link button
// was tapped, so the count comes from PostHog:
//   link_click  — recorded server-side by the website's /r/wa?b=<batch> redirect (the
//                 "Tracked link" button): counted even if the page never loads; bots and
//                 link previews skipped. One person = one IP (distinct_id), as the UTM Links page.
//   $pageview   — a visit that arrived with utm_campaign = <batch> (older batches, or a
//                 button that links to the site directly).
// A batch's clicks = the larger of the two, in people.
// Near-live: kept 1 minute and never served stale (the analytics default keeps a 6-hour stale
// copy, so a batch looked at before anyone tapped stayed at 0); force = "Refresh results".
import 'server-only';
import { hogql, posthogConfigured } from './posthogHogql.js';

const SAFE = /^wc-[a-z0-9-]+$/;
const LIVE = { fresh: 60_000, stale: 0 };

// slugs → { clicks: Map slug → people, note }
export async function batchClicks(slugs = [], { force = false } = {}) {
  const ok = [...new Set(slugs.filter((s) => SAFE.test(String(s || ''))))];
  if (!ok.length) return { clicks: new Map(), note: null };
  if (!posthogConfigured()) return { clicks: new Map(), note: 'posthog_not_configured' };
  const list = ok.map((s) => `'${s}'`).join(',');
  const clicks = new Map();
  try {
    const [taps, visits] = await Promise.all([
      hogql(`SELECT properties.batch, count(DISTINCT distinct_id) FROM events WHERE event = 'link_click' AND properties.slug = 'wa' AND properties.batch IN (${list}) AND timestamp >= now() - INTERVAL 120 DAY GROUP BY properties.batch`, { ...LIVE, force }),
      hogql(`SELECT properties.utm_campaign, count(DISTINCT person_id) FROM events WHERE event = '$pageview' AND properties.utm_campaign IN (${list}) AND timestamp >= now() - INTERVAL 120 DAY GROUP BY properties.utm_campaign`, { ...LIVE, force }),
    ]);
    for (const [s, n] of [...(taps || []), ...(visits || [])]) clicks.set(s, Math.max(clicks.get(s) || 0, Number(n) || 0));
    return { clicks, note: null };
  } catch (e) {
    return { clicks, note: String(e?.message || e).slice(0, 100) };
  }
}
