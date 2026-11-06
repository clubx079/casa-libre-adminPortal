// POST /api/inbox/translate { texts: [] } → { english: [] } — the inbox's "Translate" (free
// services, lib/translate.js; cached per process). Up to 40 texts of 2,000 characters.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 40).map((t) => String(t || '').slice(0, 2000));
  // a few at a time: 40 at once got the free service throttled and half the messages came back empty
  const english = new Array(texts.length).fill(null);
  let next = 0;
  const worker = async () => {
    while (next < texts.length) {
      const i = next++;
      english[i] = texts[i].trim() ? await translateToEnglish(texts[i]).catch(() => null) : '';
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, texts.length) }, worker));
  return NextResponse.json({ english });
}
