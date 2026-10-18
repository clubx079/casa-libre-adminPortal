// GET /api/inbox/templates?mode= → the approved WhatsApp templates (name, language,
// category, body, how many variables) for the inbox's "Template" composer. Sign-in code
// templates are left out (those are sent by the website only).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf } from '@/lib/relayInbox';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const r = await relay(modeOf(new URL(req.url).searchParams.get('mode')), '/templates');
  const data = (r.data?.data || []).filter((t) => String(t.category).toLowerCase() !== 'authentication');
  return NextResponse.json({ data, error: r.ok ? null : r.data?.error || null }, { status: r.ok ? 200 : r.status });
}
