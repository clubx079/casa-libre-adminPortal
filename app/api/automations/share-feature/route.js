// GET /api/automations/share-feature → the "Share feature announcement" card of the Automations
//     page (lib/shareFeatureAdmin.js): settings, the templates to pick from, emails sent.
// PUT { … } → save the card (the first save creates the row, off, and the default Spanish email).
// Active country.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError } from '@/lib/automationDb';
import { SHARE_FEATURE_ID, shareFeatureConfig, shareFeatureCounts, saveShareFeature, shareFeatureScheduleText } from '@/lib/shareFeatureAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function payload(db) {
  const [rows, templates, logs] = await Promise.all([
    db.select('automations', `select=*&id=eq.${SHARE_FEATURE_ID}&limit=1`).catch(() => []),
    db.select('email_templates', 'select=id,key,name,subject,is_active&order=created_at.asc'),
    db.select('email_log', `select=dedupe_key,status,created_at&automation_id=eq.${SHARE_FEATURE_ID}&order=created_at.desc&limit=50000`).catch(() => []),
  ]);
  const row = rows[0] || null;
  const settings = shareFeatureConfig(row);
  return {
    settings: { ...settings, setUp: !!row, schedule: shareFeatureScheduleText(settings) },
    counts: shareFeatureCounts(logs),
    templates,
    country: activeCountry(),
  };
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
    const v = await saveShareFeature(db, body);
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    return NextResponse.json(await payload(db));
  } catch (e) { return dbError(e); }
}
