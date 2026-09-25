// GET    /api/email-templates/:id → one template (+ usage)
// PUT    /api/email-templates/:id → save edits
// DELETE /api/email-templates/:id → delete (blocked for system templates and for
//                                    templates an automation step still uses)
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { validateTemplate, templateUsage } from '@/lib/automationAdmin';
import { dbError, q } from '@/lib/automationDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function load(db, id) {
  const [row] = await db.select('email_templates', `select=*&id=eq.${q(id)}&limit=1`);
  if (!row) return null;
  const automations = await db.select('automations', 'select=id,gift_template_id,reminder_template_id');
  return { ...row, usedBy: templateUsage(row.id, automations) };
}

export async function GET(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const row = await load(dbFor(activeCountry()), params.id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ row, country: activeCountry() });
  } catch (e) { return dbError(e); }
}

export async function PUT(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateTemplate(body);
  if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
  const db = dbFor(activeCountry());
  try {
    const rows = await db.update('email_templates', `id=eq.${q(params.id)}`, { ...v.value, updated_at: new Date().toISOString() });
    if (!rows?.length) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ row: await load(db, params.id) });
  } catch (e) { return dbError(e); }
}

export async function DELETE(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const db = dbFor(activeCountry());
  try {
    const row = await load(db, params.id);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    if (row.key) return NextResponse.json({ error: 'system_template', message: 'Built-in templates can be edited but not deleted.' }, { status: 409 });
    if (row.usedBy.length) return NextResponse.json({ error: 'in_use', message: `Used by: ${row.usedBy.join(', ')}. Pick another template there first.` }, { status: 409 });
    await db.remove('email_templates', `id=eq.${q(params.id)}`);
    return NextResponse.json({ ok: true });
  } catch (e) { return dbError(e); }
}
