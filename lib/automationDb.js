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

// email_log holds WhatsApp sends too (migration 017, dedupe key "<key>:wa") and event
// records that are not messages at all (a deleted listing, dedupe key "<key>:ev" —
// lib/listingDeletion.js). Email counts and lists add this filter so they keep counting
// emails only. Uses dedupe_key, which every country DB already has, so it works with or
// without migration 017.
export const EMAIL_ONLY = 'or=(dedupe_key.is.null,and(dedupe_key.not.like.%25%3Awa,dedupe_key.not.like.%25%3Aev))';
