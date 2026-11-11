// POST /api/translate-preview { text } → { text, via } — "Preview in English" on the admin's
// Reports and Feedback pages (users write in Spanish). The same Groq translation as the
// website's listing "Translate" button (lib/groqTranslate.js, a copy of the buyer portal's
// lib/translate.js); if Groq isn't set up or doesn't answer, the free translator the
// email-template preview uses (lib/translate.js). Preview only: nothing is saved.
// Admins only; each text is translated once and saved (lib/translationCache.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateText, cleanDescription } from '@/lib/groqTranslate';
import { translateToEnglish } from '@/lib/translate';
import { sharedTranslationCache } from '@/lib/translationCache';
import { controlStore } from '@/lib/translationStore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const SYSTEM = `You translate messages that users of a real-estate website wrote (feedback, complaints, reports about listings) into English.
Rules: translate all of the text into English, keeping its tone. Keep names, numbers, prices, currencies (₲, Gs., US$), phone numbers, emails and links exactly as written. Keep the line breaks. Do not add, remove or summarize anything.
Reply with the translation only: no notes, no quotes, no heading.`;
const version = () => `groq1:${process.env.GROQ_MODEL || 'openai/gpt-oss-20b'}`;

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const text = cleanDescription(body.text);
  if (!text) return NextResponse.json({ error: 'empty' }, { status: 400 });

  // a saved translation first; Groq only when there is none (then it is saved). The backup
  // translator's answer is shown but not saved, so Groq gets another go next time.
  let via = 'saved';
  const [out] = await sharedTranslationCache(controlStore).translateMany([text], {
    from: 'es', to: 'en', purpose: 'user-text-en', version: version(),
    translate: async (t) => {
      const groq = await translateText(t, 'en', { system: SYSTEM }).catch(() => null);
      if (groq) { via = 'groq'; return { text: groq, engine: 'groq' }; }
      const backup = await translateToEnglish(t).catch(() => null);
      via = 'fallback';
      return backup ? { text: backup, persist: false, engine: 'backup' } : null;
    },
  });
  if (!out) return NextResponse.json({ error: 'translate_failed', message: 'The translation service didn’t answer. Try again in a moment.' }, { status: 502 });
  return NextResponse.json({ text: out, via });
}
