import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { update } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EDITABLE = ['status', 'name', 'url', 'description'];

// PATCH /api/scraper-registry/:id -> update editable fields (incl. status toggle)
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }

  if ('status' in body && !['pending', 'running'].includes(body.status)) {
    return NextResponse.json({ error: 'Estado invalido' }, { status: 400 });
  }

  const patch = {};
  for (const k of EDITABLE) if (k in body) patch[k] = body[k] === '' ? null : body[k];
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });
  if (patch.url != null && !/^https?:\/\//i.test(String(patch.url))) {
    return NextResponse.json({ error: 'La URL debe empezar con http:// o https://' }, { status: 400 });
  }
  patch.updated_at = new Date().toISOString();

  try {
    const [row] = await update('scraper_registry', `id=eq.${params.id}`, patch, { returning: 'representation' });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
