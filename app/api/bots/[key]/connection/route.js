// POST /api/bots/<key>/connection { url, key } → save the Grok routine webhook (the key stays on the server)
// DELETE /api/bots/<key>/connection → disconnect
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { saveConnection, removeConnection } from '@/lib/bots/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const fail = (e) => NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: e?.status || 500 });

export async function POST(req, { params }) {
  const s = getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { const b = await req.json(); await saveConnection(params.key, { url: b.url, webhookKey: b.key }, s.email); return NextResponse.json({ ok: true }); }
  catch (e) { return fail(e); }
}
export async function DELETE(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { await removeConnection(params.key); return NextResponse.json({ ok: true }); } catch (e) { return fail(e); }
}
