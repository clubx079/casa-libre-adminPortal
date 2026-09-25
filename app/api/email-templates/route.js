// GET  /api/email-templates → all templates for the active country (+ which automation
//                             step uses each, + how many were sent and when last).
// POST /api/email-templates → create a custom template.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { validateTemplate, templateUsage } from '@/lib/automationAdmin';
import { dbError } from '@/lib/automationDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const { select } = dbFor(activeCountry());
  try {
    const [templates, automations, logs] = await Promise.all([
      select('email_templates', 'select=*&order=created_at.asc'),
      select('automations', 'select=id,gift_template_id,reminder_template_id'),
      select('email_log', 'select=template_id,status,created_at&status=eq.sent&order=created_at.desc&limit=5000'),
    ]);
    const sent = new Map();
    for (const l of logs) {
      const k = String(l.template_id);
      const cur = sent.get(k) || { count: 0, last: null };
      cur.count++;
      if (!cur.last) cur.last = l.created_at;
      sent.set(k, cur);
    }
    const rows = templates.map((t) => ({
      ...t,
      usedBy: templateUsage(t.id, automations),
      sentCount: sent.get(String(t.id))?.count || 0,
      lastSentAt: sent.get(String(t.id))?.last || null,
    }));
    return NextResponse.json({ rows, country: activeCountry() });
  } catch (e) { return dbError(e); }
}

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const v = validateTemplate(body);
  if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
  const { insert } = dbFor(activeCountry());
  try {
    const [row] = await insert('email_templates', [{ ...v.value, key: null }]);
    return NextResponse.json({ row });
  } catch (e) { return dbError(e); }
}
