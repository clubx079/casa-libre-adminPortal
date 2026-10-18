// GET /api/inbox/media/:messageId?mode= → the photo / voice note / document of a message,
// streamed from Relay (it keeps a copy after Meta deletes media at 30 days).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const id = String(params.id || '');
  if (!/^msg_[A-Za-z0-9]+$/.test(id)) return NextResponse.json({ error: 'bad_id' }, { status: 400 });
  const range = req.headers.get('range');
  const r = await relay(modeOf(new URL(req.url).searchParams.get('mode')), `/media/${id}`, { raw: true, headers: range ? { Range: range } : {} });
  if (!r.ok && r.status !== 206) return NextResponse.json({ error: 'media_not_found' }, { status: r.status || 404 });
  const h = new Headers();
  for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'content-disposition']) if (r.headers.get(k)) h.set(k, r.headers.get(k));
  h.set('cache-control', 'private, max-age=3600');
  return new Response(r.body, { status: r.status, headers: h });
}
