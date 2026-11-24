// GET /api/email/settings → { rules: [{ email, categories }], saved, updatedAt, updatedBy }
// PUT { rules } → saves which email types (important / marketing / other / spam) are forwarded
// to which addresses (lib/emailForwarding.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { readForwarding, saveForwarding } from '@/lib/emailForwarding';
import { invalidEmails } from '@/lib/emailTriageCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  return NextResponse.json(await readForwarding({ fresh: true }));
}

export async function PUT(req) {
  const s = getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const b = await req.json().catch(() => ({}));
  const bad = invalidEmails(b.rules);
  if (bad.length) return NextResponse.json({ error: `Not a valid email address: ${bad.join(', ')}` }, { status: 400 });
  try {
    return NextResponse.json(await saveForwarding(b.rules, s.email || s.name || null));
  } catch (e) {
    return NextResponse.json({ error: `Could not save: ${e?.message || e}` }, { status: 500 });
  }
}
