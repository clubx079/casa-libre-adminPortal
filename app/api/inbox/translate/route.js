// POST /api/inbox/translate { texts: [] } → { english: [] } — the inbox's "Translate" (free
// services, lib/translate.js; cached per process). Up to 40 texts of 2,000 characters.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const texts = (Array.isArray(b.texts) ? b.texts : []).slice(0, 40).map((t) => String(t || '').slice(0, 2000));
  const english = await Promise.all(texts.map((t) => (t.trim() ? translateToEnglish(t).catch(() => null) : '')));
  return NextResponse.json({ english });
}
