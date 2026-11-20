// POST /api/bots/runs/<id> { approval: 'approved' | 'rejected' } → a person's decision on a bot run's results.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { setApproval } from '@/lib/bots/store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req, { params }) {
  const s = getSession();
  if (!s) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { const b = await req.json(); await setApproval(params.id, b.approval, s.email); return NextResponse.json({ ok: true }); }
  catch (e) { return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: e?.status || 500 }); }
}
