// The Admin Manager's memory for the active country: standing notes every run reads
// (lib/manager/memory.js — automations row 'manager_memory', no table of its own).
// GET    /api/manager/memory          → { notes }
// POST   /api/manager/memory { text, source? } → add a note ('admin', or 'suggestion' when an
//                                        admin keeps a lesson the manager suggested)
// DELETE /api/manager/memory { id }   → forget a note
import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError } from '@/lib/automationDb';
import { readMemory, writeMemory, addNote, removeNote } from '@/lib/manager/memory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  try { return NextResponse.json({ notes: await readMemory(dbFor(activeCountry())) }); } catch (e) { return dbError(e); }
}

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = dbFor(activeCountry());
  try {
    const res = addNote(await readMemory(db), { text: body.text, by: session.email || null, source: body.source === 'suggestion' ? 'suggestion' : 'admin', id: crypto.randomUUID() });
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 });
    return NextResponse.json({ notes: await writeMemory(db, res.notes) });
  } catch (e) { return dbError(e); }
}

export async function DELETE(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const db = dbFor(activeCountry());
  try { return NextResponse.json({ notes: await writeMemory(db, removeNote(await readMemory(db), String(body.id || ''))) }); } catch (e) { return dbError(e); }
}
