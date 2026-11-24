// GET /api/automations/newsletter → the "Weekly newsletter" card (lib/newsletterAdmin.js):
//     settings, the templates to pick from, sent per week.
// PUT { day, hour, rotation, next, enabled, autogen } → save (first save creates the row).
// POST { action: 'generate' } → write this week's edition now (lib/newsletterEditionRun.js), in
//     the background; the card reloads to see it. Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError, EMAIL_ONLY } from '@/lib/automationDb';
import { NEWSLETTER_ID, newsletterSettings, saveNewsletter, newsletterWeekCounts } from '@/lib/newsletterAdmin';
import { editionSummary } from '@/lib/newsletterEditionCore';
import { countryInfo } from '@/lib/automationAdmin';
import { TABLE as EDITIONS, startEditionIfDue } from '@/lib/newsletterEditionRun';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function payload(db) {
  const [[row], templates, logs, editions] = await Promise.all([
    db.select('automations', `select=*&id=eq.${NEWSLETTER_ID}&limit=1`).catch(() => []),
    db.select('email_templates', 'select=id,key,name,subject,is_active&order=created_at.asc'),
    db.select('email_log', `select=dedupe_key&automation_id=eq.${NEWSLETTER_ID}&status=in.(sent,delivered,read)&order=created_at.desc&limit=20000&${EMAIL_ONLY}`).catch(() => []),
    // null = the table isn't there yet (website migration 026 not run in this country)
    db.select(EDITIONS, 'select=id,week,date,status,error,model,created_at,issues,stories&order=created_at.desc&limit=6').catch(() => null),
  ]);
  return {
    settings: newsletterSettings(row || null), templates, perWeek: newsletterWeekCounts(logs), sent: logs.length, country: activeCountry(),
    editions: editions ? editions.map(editionSummary) : null,
    site: countryInfo(activeCountry()).site,
  };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try { return NextResponse.json(await payload(dbFor(activeCountry()))); } catch (e) { return dbError(e); }
}

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const country = activeCountry();
  const body = await req.json().catch(() => ({}));
  if (body.action !== 'generate') return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  const r = await startEditionIfDue(country, { force: true });
  if (!r.started) return NextResponse.json({ error: r.reason, message: r.reason === 'exists' ? `This week's edition (${r.week}) is already published.` : r.reason === 'generating' ? 'An edition is being written right now.' : r.reason === 'no_table' ? 'Run the newsletter_editions SQL (website migration 026) in this country first.' : (r.error || r.reason) }, { status: 409 });
  return NextResponse.json({ ok: true, ...r, ...(await payload(dbFor(country))) });
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const db = dbFor(activeCountry());
  const body = await req.json().catch(() => ({}));
  try {
    const v = await saveNewsletter(db, body);
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    return NextResponse.json(await payload(db));
  } catch (e) { return dbError(e); }
}
