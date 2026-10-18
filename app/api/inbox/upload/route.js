// POST /api/inbox/upload?mode= (multipart: to, file, caption) → Relay /v1/messages/media.
// Photo / document / voice note, inside the 24h window.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const form = await req.formData();
  const file = form.get('file');
  if (!file || typeof file === 'string') return NextResponse.json({ error: { code: 'no_file' } }, { status: 400 });
  if (file.size > 25 * 1024 * 1024) return NextResponse.json({ error: { code: 'file_too_large', message: 'Max 25 MB.' } }, { status: 413 });
  const out = new FormData();
  out.set('to', String(form.get('to') || ''));
  if (form.get('caption')) out.set('caption', String(form.get('caption')).slice(0, 1024));
  out.set('file', file, file.name || 'file');
  const r = await relay(mode, '/messages/media', { method: 'POST', body: out });
  return NextResponse.json(r.data, { status: r.ok ? 200 : r.status });
}
