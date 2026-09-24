// GET /api/analytics/emails?days=30 — emails sent through Resend by the ACTIVE
// country's site, and how many were opened. Reads Resend's "List sent emails"
// API directly (no database): needs a FULL-ACCESS key in RESEND_READ_API_KEY
// (the sites' own keys are send-only and cannot list).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { SENDER_DOMAIN, fromDomain, summarize, emailType } from '@/lib/emailStats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PAGE = 100;          // Resend max per page
const MAX_PAGES = 40;      // up to 4,000 emails per request
const PAUSE_MS = 550;      // Resend allows ~2 requests/second
const CACHE_MS = 5 * 60 * 1000;
const cache = new Map();   // `${country}:${days}` -> { at, body }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function listSince(key, cutoffMs) {
  const out = [];
  let after = null, truncated = false;
  for (let i = 0; i < MAX_PAGES; i++) {
    if (i) await sleep(PAUSE_MS);
    const qs = new URLSearchParams({ limit: String(PAGE) });
    if (after) qs.set('after', after);
    const res = await fetch(`https://api.resend.com/emails?${qs}`, { headers: { Authorization: `Bearer ${key}` }, cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.message || `Resend HTTP ${res.status}`);
    const data = Array.isArray(json.data) ? json.data : [];
    let reachedOld = false;
    for (const e of data) {
      if (new Date(e.created_at).getTime() < cutoffMs) { reachedOld = true; break; }
      out.push(e);
    }
    if (reachedOld || !json.has_more || !data.length) return { rows: out, truncated };
    after = data[data.length - 1].id;
    if (i === MAX_PAGES - 1) truncated = true;
  }
  return { rows: out, truncated };
}

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const key = process.env.RESEND_READ_API_KEY;
  if (!key) return NextResponse.json({ error: 'no_key' }, { status: 200 });

  const country = activeCountry();
  const domain = SENDER_DOMAIN[country];
  const days = Math.min(Math.max(parseInt(new URL(req.url).searchParams.get('days') || '30', 10) || 30, 1), 365);
  const ck = `${country}:${days}`;
  const hit = cache.get(ck);
  if (hit && Date.now() - hit.at < CACHE_MS) return NextResponse.json(hit.body);

  try {
    const { rows, truncated } = await listSince(key, Date.now() - days * 86400000);
    const mine = rows.filter((e) => fromDomain(e.from) === domain);
    const body = {
      country, domain, days, truncated,
      ...summarize(mine),
      recent: mine.slice(0, 25).map((e) => ({
        id: e.id,
        to: Array.isArray(e.to) ? e.to.join(', ') : String(e.to || ''),
        type: emailType(e.subject),
        subject: e.subject,
        status: e.last_event || 'sent',
        at: e.created_at,
      })),
    };
    cache.set(ck, { at: Date.now(), body });
    return NextResponse.json(body);
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
