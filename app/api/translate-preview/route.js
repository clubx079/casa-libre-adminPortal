// POST /api/translate-preview { text } → { text, via } — "Preview in English" on the admin's
// Reports and Feedback pages (users write in Spanish). The same Groq translation as the
// website's listing "Translate" button (lib/groqTranslate.js, a copy of the buyer portal's
// lib/translate.js); if Groq isn't set up or doesn't answer, the free translator the
// email-template preview uses (lib/translate.js). Preview only: nothing is saved.
// Admins only; each text is translated once per server (cache).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateText, createCache, cleanDescription } from '@/lib/groqTranslate';
import { translateToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const cache = createCache(2000);
const SYSTEM = `You translate messages that users of a real-estate website wrote (feedback, complaints, reports about listings) into English.
Rules: translate all of the text into English, keeping its tone. Keep names, numbers, prices, currencies (₲, Gs., US$), phone numbers, emails and links exactly as written. Keep the line breaks. Do not add, remove or summarize anything.
Reply with the translation only: no notes, no quotes, no heading.`;

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = cleanDescription(body.text);
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });

  const hit = cache.get(text, 'en');
  if (hit) return NextResponse.json({ text: hit, via: 'cache' });

  let out = await translateText(text, 'en', { system: SYSTEM }).catch(() => null);
  let via = 'groq';
  if (!out) {
    out = await translateToEnglish(text).catch(() => null);
    via = 'fallback';
  }
  if (!out) return NextResponse.json({ error: 'translate_failed', message: 'The translation service didn’t answer. Try again in a moment.' }, { status: 502 });
  cache.set(text, 'en', out);
  return NextResponse.json({ text: out, via });
}
