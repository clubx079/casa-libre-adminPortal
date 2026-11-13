import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { leadPatch, isMissingTable } from '@/lib/funnelLeads';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const uuidOk = (id) => /^[0-9a-f-]{36}$/i.test(String(id || ''));

// PATCH /api/funnels/leads/:id { status?, notes? } → updates that lead in the ACTIVE
// country's DB and stamps handled_by (the signed-in admin) and handled_at (now).
// Only called when an admin changes a lead on the Funnels page.
export async function PATCH(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!uuidOk(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const body = await req.json().catch(() => null);
  const { patch, error } = leadPatch(body, session.name || session.email || 'admin');
  if (error) return NextResponse.json({ error }, { status: 400 });
  try {
    const [row] = await dbFor(activeCountry()).update('funnel_leads', `id=eq.${params.id}`, patch, { returning: 'representation' });
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: 'Run the funnel_leads migration on this country\'s database', missing: true }, { status: 409 });
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
