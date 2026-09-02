// Unified per-source usage log for billable Google APIs. Casa Libre only calls
// Cloud Vision (Places/Geocoding are never used — adapters take lat/lng from the
// source feed), but the schema matches DeelMap's so one hourly monitor can read
// both. Every screening batch appends one row → table `api_usage_log`.
//
// Fire-and-forget: NEVER throws, NEVER blocks a scrape. No-ops if the table is
// absent (migration not applied). Call as `void logApiCall({...})`.
import 'server-only';
import { insert } from './db';

export async function logApiCall({ api, source, path, calls }) {
  const n = Math.max(0, Math.floor(calls || 0));
  if (!n) return;
  try {
    await insert('api_usage_log', {
      api,
      source: source || 'unknown',
      code_path: path || 'unknown',
      calls: n,
    }, { returning: 'minimal' });
  } catch {
    // best-effort only — missing table / RLS / network must never affect the scrape
  }
}
