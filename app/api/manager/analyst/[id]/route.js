// GET /api/manager/analyst/:id → one AI Analyst run: status/stage while running; the analysis,
// the key numbers and the data pack it read when done (lib/analyst/run.js).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { getRun } from '@/lib/analyst/run';
import { mayRead } from '@/lib/analyst/access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const run = await getRun(params.id);
  if (!run || !mayRead(run.country)) return NextResponse.json({ error: 'not found' }, { status: 404 });
  return NextResponse.json({ run });
}
