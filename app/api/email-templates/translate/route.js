// POST /api/email-templates/translate → the template's text fields in English, for
// the editor's "Preview in English" and its English panel. With { texts: [...] } it
// translates a list instead (custom template names, for the list and the pickers).
// Preview only: nothing is saved or sent.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateManyToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELDS = ['subject', 'heading', 'body', 'button_label'];

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (Array.isArray(body.texts)) {
      const texts = await translateManyToEnglish(body.texts.slice(0, 50).map((t) => String(t ?? '').slice(0, 300)));
      return NextResponse.json({ ok: true, texts });
    }
    // the four fields in one saved-translation lookup; only edited fields are translated again
    const en = await translateManyToEnglish(FIELDS.map((f) => String(body[f] ?? '').slice(0, 4000)));
    if (en.some((x) => x == null)) throw new Error('translate_failed');
    const out = Object.fromEntries(FIELDS.map((f, i) => [f, en[i]]));
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: 'translate_failed', message: 'The translation service didn’t answer. Try again in a moment.' }, { status: 502 });
  }
}
