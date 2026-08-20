import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { getSession } from '@/lib/auth';
import { select, insert, update } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ACTIONS = ['release', 'discard'];

// PATCH /api/quarantine/:id  { action: 'release' | 'discard' }
// release -> promote the held payload into `properties` (active) + mark released.
// discard -> mark discarded (payload stays for the record, never published).
export async function PATCH(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Bad request' }, { status: 400 }); }
  if (!ACTIONS.includes(body.action)) return NextResponse.json({ error: 'Accion invalida' }, { status: 400 });

  try {
    const [row] = await select('ingest_quarantine', `id=eq.${params.id}&limit=1`);
    if (!row) return NextResponse.json({ error: 'No encontrado' }, { status: 404 });

    const ts = new Date().toISOString();
    const reviewer = session.email || 'admin';

    if (body.action === 'discard') {
      const [u] = await update('ingest_quarantine', `id=eq.${params.id}`,
        { status: 'discarded', reviewed_at: ts, reviewed_by: reviewer }, { returning: 'representation' });
      return NextResponse.json({ ok: true, row: u });
    }

    // release: promote the payload into properties (idempotent per source+external)
    const payload = row.payload || {};
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    await insert('properties', [{
      ...payload,
      source_id: row.source_id,
      external_id: row.external_id,
      source_hash: hash,
      admin_status: 'active',
      is_delisted: false,
      first_scraped_at: ts,
      last_scraped_at: ts,
      last_seen_at: ts,
    }], { upsert: true, onConflict: 'source_id,external_id', returning: 'minimal' });

    const [u] = await update('ingest_quarantine', `id=eq.${params.id}`,
      { status: 'released', reviewed_at: ts, reviewed_by: reviewer }, { returning: 'representation' });
    return NextResponse.json({ ok: true, row: u });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
