import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import {
  listCountries, getAdminById, updateAdminAccess, deleteAdmin, countActiveSuperadmins,
} from '@/lib/control';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function requireSuper() {
  const s = getSession();
  if (!s) return { error: 'unauthorized', status: 401 };
  if (s.role !== 'superadmin') return { error: 'forbidden', status: 403 };
  return { session: s };
}

// PATCH /api/team/:id -> update a member's role + country access (superadmin only).
export async function PATCH(req, { params }) {
  const gate = requireSuper();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const target = await getAdminById(params.id);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'bad_request' }, { status: 400 }); }
  const role = body.role === 'superadmin' ? 'superadmin' : 'admin';

  // Guardrail: never demote the last active superadmin.
  if (target.role === 'superadmin' && role !== 'superadmin' && target.is_active) {
    const count = await countActiveSuperadmins();
    if (count <= 1) return NextResponse.json({ error: 'last_superadmin' }, { status: 400 });
  }

  let allowed_countries = null;
  if (role === 'admin') {
    const registry = await listCountries();
    const codes = registry.map((c) => c.code);
    const picked = Array.isArray(body.allowed_countries) ? body.allowed_countries.map((c) => String(c).toLowerCase()) : [];
    allowed_countries = picked.filter((c) => codes.includes(c));
    if (allowed_countries.length === 0) return NextResponse.json({ error: 'no_countries' }, { status: 400 });
  }

  try {
    const updated = await updateAdminAccess(params.id, { role, allowed_countries });
    return NextResponse.json({ ok: true, admin: updated });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// DELETE /api/team/:id -> remove a member (superadmin only).
export async function DELETE(_req, { params }) {
  const gate = requireSuper();
  if (gate.error) return NextResponse.json({ error: gate.error }, { status: gate.status });

  const target = await getAdminById(params.id);
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404 });

  // Guardrail: never remove the last active superadmin.
  if (target.role === 'superadmin' && target.is_active) {
    const count = await countActiveSuperadmins();
    if (count <= 1) return NextResponse.json({ error: 'last_superadmin' }, { status: 400 });
  }

  try {
    await deleteAdmin(params.id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
