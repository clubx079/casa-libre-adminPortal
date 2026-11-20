// Loads Email & WhatsApp campaign numbers for one country (lib/messageCampaigns.js does the
// counting). Server-only. Cached per country + range for 5 minutes (lib/swrCache.js), so the
// Overview cards and the Email campaigns page share one load.
//   email_log  every message an automation sent (each country's DB)
//   Resend     opens / clicks of those emails, and the site's own emails (≈ the last 30 days)
//   PostHog    people who tapped a WhatsApp button: automation templates (utm_campaign cl_…)
//              and campaign batches (the /r/wa tracked link, or utm_campaign wc-…)
import 'server-only';
import { dbFor } from './db.js';
import { selectAll } from './selectAll.js';
import { swr } from './swrCache.js';
import { countryEmails } from './resendEmails.js';
import { emailType } from './emailStats.js';
import { isInternalEmail, HIDDEN_EMAIL_TYPES } from './internalTraffic.js';
import { internalEmails } from './internalAudience.js';
import { hogql, posthogConfigured } from './posthogHogql.js';
import { siteClause } from './analyticsSite.js';
import { summarizeCampaigns } from './messageCampaigns.js';

export const RANGES = [7, 30, 90];
const flat = (rows) => (rows || []).map((r) => (Array.isArray(r) ? r : Object.values(r)));
const recipients = (e) => (Array.isArray(e.to) ? e.to : [e.to]).map((x) => String(x || '').toLowerCase());

async function waClicks(country, days, templateKey) {
  if (!posthogConfigured()) return { rows: [], note: 'PostHog is not connected, so WhatsApp clicks are missing.' };
  const rows = flat(await hogql(`
    SELECT multiIf(event = 'link_click', 'wa_campaign', startsWith(coalesce(properties.utm_campaign, ''), 'wc-'), 'wa_campaign', coalesce(properties.utm_campaign, '')) AS t,
           multiIf(timestamp >= now() - INTERVAL 7 DAY, 'w', timestamp >= now() - INTERVAL 14 DAY, 'p', 'o') AS wk,
           count(DISTINCT distinct_id)
    FROM events
    WHERE timestamp >= now() - INTERVAL ${days} DAY${siteClause(country)}
      AND ((event = 'link_click' AND properties.slug = 'wa')
        OR (event = '$pageview' AND properties.utm_source = 'whatsapp' AND properties.utm_medium = 'whatsapp' AND startsWith(coalesce(properties.utm_campaign, ''), 'cl_'))
        OR (event = '$pageview' AND startsWith(coalesce(properties.utm_campaign, ''), 'wc-')))
    GROUP BY t, wk`));
  return { rows: rows.map(([t, wk, n]) => ({ key: t === 'wa_campaign' ? 'wa_campaign' : templateKey.get(String(t)) || null, wk, n: Number(n) || 0 })) };
}

async function load(country, range) {
  const days = Math.max(range, 14);              // the week-by-week comparison needs 14 days
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = dbFor(country);
  const [extra, logs, resend] = await Promise.all([
    internalEmails(country).catch(() => new Set()),
    selectAll(db, 'email_log', `select=automation_id,channel,status,resend_id,subject,to_email,created_at&created_at=gte.${encodeURIComponent(since)}&automation_id=not.is.null&order=id.asc`),
    countryEmails(country, days).catch(() => null),
  ]);
  const mine = logs.filter((m) => !isInternalEmail(m.to_email, extra) && !['test', 'skipped'].includes(String(m.status)));
  const sites = (resend?.rows || []).filter((e) => !HIDDEN_EMAIL_TYPES.includes(emailType(e.subject)) && !recipients(e).some((x) => isInternalEmail(x, extra)));
  // WhatsApp template (cl_…) → the automation that sends it
  const templateKey = new Map();
  for (const m of mine) if (m.channel === 'whatsapp') templateKey.set(String(m.subject || '').replace(/^WhatsApp\s*·\s*/i, '').trim(), m.automation_id);
  const clicks = await waClicks(country, days, templateKey).catch((e) => ({ rows: [], note: `WhatsApp clicks: ${String(e?.message || e).slice(0, 120)}` }));
  const inRange = (wk) => wk === 'w' || (wk === 'p' && range >= 14) || (wk === 'o' && range > 14);
  const out = summarizeCampaigns({
    logs: mine, resend: sites, range,
    waClicks: clicks.rows.filter((c) => c.key).map((c) => ({ key: c.key, week: c.wk === 'o' ? null : c.wk, inRange: inRange(c.wk), n: c.n })),
  });
  const notes = [
    resend ? null : 'Resend is not readable (RESEND_READ_API_KEY), so opens, clicks and site emails are missing.',
    range > 30 ? 'Resend keeps about 30 days: opens and clicks of older emails, and site emails older than that, are not counted.' : null,
    resend?.truncated ? 'Resend’s history does not reach the start of this period.' : null,
    clicks.note || null,
  ].filter(Boolean);
  return { ...out, range, notes, at: new Date().toISOString() };
}

export function campaignsFor(country, range = 30, { force = false } = {}) {
  const r = RANGES.includes(Number(range)) ? Number(range) : 30;
  return swr(`msgCampaigns:${country}:${r}`, () => load(country, r), { fresh: 5 * 60_000, stale: 60 * 60_000, force });
}
