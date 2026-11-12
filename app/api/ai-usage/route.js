// GET /api/ai-usage — the AI usage page: every AI call (Anthropic Claude + Groq) the admin and the
// website made for the active country in the last 30 days (ai_usage_log, migrations/
// 010_ai_usage_log.sql), added up by lib/aiUsageCore.js summarize(), with the price table used.
// Read-only. No table yet → { missing: true } and the page says which migration to run.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { usageRows } from '@/lib/aiUsage';
import { summarize, FEATURE_LABEL } from '@/lib/aiUsageCore';
import { PRICES } from '@/lib/aiPricing';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador' };
// the country's UTC offset in minutes right now (Paraguay -180), so "today" is their day
function tzOffset(cc, now = new Date()) {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: TZ[cc] || 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(now).map((p) => [p.type, p.value]));
    const local = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute);
    return Math.round((local - Math.floor(now.getTime() / 60000) * 60000) / 60000);
  } catch { return 0; }
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const now = Date.now();
  const since = new Date(now - 31 * 86400000).toISOString();
  const got = await usageRows(dbFor(cc), since);
  const prices = Object.entries(PRICES).map(([model, p]) => ({ model, ...p }));
  if (!got.ok) return NextResponse.json({ country: cc, missing: !!got.missing, error: got.error || null, prices, labels: FEATURE_LABEL }, { status: got.missing ? 200 : 500 });
  const tzMin = tzOffset(cc);
  return NextResponse.json({ country: cc, tzMin, rows: got.rows.length, ...summarize(got.rows, { now, tzMin }), prices, labels: FEATURE_LABEL, at: new Date(now).toISOString() });
}
