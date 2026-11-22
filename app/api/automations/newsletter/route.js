// GET /api/automations/newsletter → the "Weekly newsletter" card (lib/newsletterAdmin.js):
//     settings, the templates to pick from, sent per week.
// PUT { day, hour, rotation, next, enabled } → save (first save creates the row). Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError, EMAIL_ONLY } from '@/lib/automationDb';
import { NEWSLETTER_ID, newsletterSettings, saveNewsletter, newsletterWeekCounts } from '@/lib/newsletterAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function payload(db) {
  const [[row], templates, logs] = await Promise.all([
    db.select('automations', `select=*&id=eq.${NEWSLETTER_ID}&limit=1`).catch(() => []),
    db.select('email_templates', 'select=id,key,name,subject,is_active&order=created_at.asc'),
    db.select('email_log', `select=dedupe_key&automation_id=eq.${NEWSLETTER_ID}&status=in.(sent,delivered,read)&order=created_at.desc&limit=20000&${EMAIL_ONLY}`).catch(() => []),
  ]);
  return { settings: newsletterSettings(row || null), templates, perWeek: newsletterWeekCounts(logs), sent: logs.length, country: activeCountry() };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try { return NextResponse.json(await payload(dbFor(activeCountry()))); } catch (e) { return dbError(e); }
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
