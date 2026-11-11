// POST /api/inbox/translate { texts: [] } → { english: [] } — the inbox's "Translate" / "English on"
// (lib/translate.js; saved translations are reused, lib/translationCache.js). Up to 40 texts of 2,000 characters.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateManyToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 40).map((t) => String(t || '').slice(0, 2000));
  // saved translations first (ONE lookup for the page of messages, lib/translationCache.js); only
  // the messages never translated before go to the translation service, 4 at a time (40 at once
  // got it throttled and half the messages came back empty)
  const english = await translateManyToEnglish(texts, { concurrency: 4 }).catch(() => texts.map(() => null));
  return NextResponse.json({ english });
}
