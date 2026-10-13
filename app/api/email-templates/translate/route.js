// POST /api/email-templates/translate → the template's text fields in English, for
// the editor's "Preview in English" and its English panel. With { texts: [...] } it
// translates a list instead (custom template names, for the list and the pickers).
// Preview only: nothing is saved or sent.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { translateToEnglish } from '@/lib/translate';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const FIELDS = ['subject', 'heading', 'body', 'button_label'];

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  try {
    if (Array.isArray(body.texts)) {
      const texts = await Promise.all(body.texts.slice(0, 50).map((t) => translateToEnglish(String(t ?? '').slice(0, 300)).catch(() => null)));
      return NextResponse.json({ ok: true, texts });
    }
    const out = {};
    for (const f of FIELDS) out[f] = await translateToEnglish(String(body[f] ?? '').slice(0, 4000));
    return NextResponse.json({ ok: true, ...out });
  } catch (e) {
    return NextResponse.json({ error: 'translate_failed', message: 'The translation service didn’t answer. Try again in a moment.' }, { status: 502 });
  }
}
