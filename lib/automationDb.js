// Shared bits for the Email templates / Automations API routes.
import 'server-only';
import { NextResponse } from 'next/server';

// Migration 005 not applied on this country's DB yet → let the page explain it.
export const isMissingTable = (e) => /does not exist|PGRST205|PGRST200|schema cache|not find the table|relation .* does not exist/i.test(String(e?.message || e));

export function dbError(e) {
  if (isMissingTable(e)) return NextResponse.json({ pending: true, error: 'migration_pending' }, { status: 200 });
  return NextResponse.json({ error: String(e?.message || e) }, { status: 500 });
}

export const q = (s) => encodeURIComponent(s);
