import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { requestControl } from '@/lib/scrape';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAP = { pause: 'pause', resume: 'run', stop: 'stop' };

// POST /api/scrape/control  { runId, action: 'pause'|'resume'|'stop' }
// Writes the control flag; the running job reads it and reacts. Stopping an
// already-dead run finalizes it directly (see requestControl).
export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });

  let runId, action;
  try {
    ({ runId, action } = await req.json());
  } catch {
    return NextResponse.json({ error: 'Bad request' }, { status: 400 });
  }
  const control = MAP[action];
  if (!runId || !control) return NextResponse.json({ error: 'runId y action válidos requeridos' }, { status: 400 });

  try {
    await requestControl(runId, control);
    return NextResponse.json({ ok: true, control });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e) }, { status: 500 });
  }
}
