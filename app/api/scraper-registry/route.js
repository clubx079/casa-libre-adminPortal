import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { select, insert } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/scraper-registry -> all registry rows, newest first
export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const rows = await select('scraper_registry', 'select=*&order=created_at.desc');
    return NextResponse.json({ rows });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}

// POST /api/scraper-registry -> propose a new site (enters as 'pending')
export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : null;
  if (!name || !url) return NextResponse.json({ error: 'Nombre y URL son requeridos' }, { status: 400 });

  try {
    const [row] = await insert('scraper_registry', [{ name, url, description, status: 'pending' }], { returning: 'representation' });
    return NextResponse.json({ ok: true, row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
