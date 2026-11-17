// Where the SEO pipeline keeps its tables (migrations/011_seo_pipeline.sql) and the small read/write
// helpers every stage shares. Server-only.
//   seoDb(cc)       the seo_* tables: the country DB (dbFor), or — LOCAL DEV ONLY, before the migration
//                   has run — the stand-in at SEO_DB_URL (scripts/dev-seo-db.mjs)
//   listingsDb(cc)  the country DB, for READING live listings (never written here)
import 'server-only';
import { dbFor, makeClient } from '../db';
import { mergeSettings } from './settings.js';

const devClient = (() => {
  let c = null;
  return () => (c ||= makeClient(process.env.SEO_DB_URL, process.env.SEO_DB_KEY || 'local-dev'));
})();
export const seoDb = (cc) => (process.env.SEO_DB_URL ? devClient() : dbFor(cc));
export const listingsDb = (cc) => dbFor(cc);
export const SEO_COUNTRIES = ['py', 'bo', 'uy', 've', 'sv'];
export const isMissingTable = (e) => ['42P01', 'PGRST205', 'PGRST204'].includes(e?.code) || /does not exist|schema cache|Could not find the table/i.test(String(e?.message || ''));
export const ccOf = (v) => { const c = String(v || 'py').toLowerCase(); return SEO_COUNTRIES.includes(c) ? c : 'py'; };
const enc = encodeURIComponent;

export async function loadSettings(cc) {
  try {
    const [row] = await seoDb(cc).select('seo_settings', `select=settings&country=eq.${cc}&limit=1`);
    return mergeSettings(row?.settings);
  } catch { return mergeSettings(null); }
}
export async function saveSettings(cc, settings, by) {
  const clean = mergeSettings(settings);
  await seoDb(cc).insert('seo_settings', [{ country: cc, settings: clean, updated_at: new Date().toISOString(), updated_by: by || null }], { upsert: true, onConflict: 'country', returning: 'minimal' });
  return clean;
}

export async function getOverrides(cc) {
  const rows = await seoDb(cc).select('seo_overrides', `select=*&country=eq.${cc}&limit=5000`);
  return new Map(rows.map((r) => [r.path, r]));
}
export async function getOverride(cc, path) {
  const [row] = await seoDb(cc).select('seo_overrides', `select=*&country=eq.${cc}&path=eq.${enc(path)}&limit=1`);
  return row || null;
}
const OVERRIDE_FIELDS = ['title', 'h1', 'description', 'enabled_variants', 'retired_variants', 'extra_links', 'title_changed_at'];
export async function putOverride(cc, path, patch) {
  const prev = await getOverride(cc, path);
  const row = { country: cc, path, ...Object.fromEntries(OVERRIDE_FIELDS.map((k) => [k, prev ? prev[k] : (k.endsWith('variants') ? [] : k === 'extra_links' ? [] : null)])), ...patch, updated_at: new Date().toISOString() };
  await seoDb(cc).insert('seo_overrides', [row], { upsert: true, onConflict: 'country,path', returning: 'minimal' });
  return { prev, next: row };
}
export const snapshot = (o) => (o ? Object.fromEntries(OVERRIDE_FIELDS.map((k) => [k, o[k] ?? null])) : null);

export async function logChange(cc, { path, action, before = null, after = null, reason = null, by = null, opportunityId = null }) {
  const [row] = await seoDb(cc).insert('seo_changes', [{ country: cc, path, action, before, after, reason, by, opportunity_id: opportunityId, created_at: new Date().toISOString() }]);
  return row;
}
