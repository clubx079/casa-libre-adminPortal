import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { update } from '@/lib/db';

export const runtime = 'nodejs';

// PATCH cron / activation settings for one source.
export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const key = params.key;
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const allowed = ['cron_enabled', 'cron_schedule', 'cron_timezone', 'is_active', 'default_filters'];
  const patch = {};
  for (const k of allowed) if (k in body) patch[k] = body[k];
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'Nada para actualizar' }, { status: 400 });

  try {
    const [row] = await update('scrape_sources', `key=eq.${encodeURIComponent(key)}`, patch);
    return NextResponse.json({ ok: true, source: row });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
