#!/usr/bin/env node
// Backfill "buyer or seller" (users.user_type / user_type_source / user_type_at /
// first_listed_at — website migration 023_user_type.sql) for EXISTING accounts of ONE
// country DB. Rules + evidence: lib/userTypeBackfill.js.
//
//   node scripts/backfill-user-type.mjs --country py            # dry run (default): counts only
//   node scripts/backfill-user-type.mjs --country py --dry-run  # same
//   node scripts/backfill-user-type.mjs --country py --execute  # writes
//   options: --force (replace types already set) · --no-posthog · --list (one line per account)
//
// DB: --country xx → AIROBASE_URL_XX + AIROBASE_SECRET_KEY_XX; without --country →
// AIROBASE_URL + AIROBASE_SECRET_KEY. Real environment variables win over .env.local.
// PostHog (POSTHOG_HOST / POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_KEY) adds the sell-wizard
// sign-up events, filtered to the country (--ph-country xx to override, e.g. for a test DB).
// Only accounts with NO type are set (unless --force); first_listed_at is only filled when empty.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyUser, backfillPatch, buildEvidence, LISTED_TEMPLATES, DRAFT_TEMPLATES, SELL_SIGNUP_EVENTS } from '../lib/userTypeBackfill.js';
import { userTypeGroup, typeShares } from '../lib/userType.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
(function loadEnvLocal() {
  const p = path.join(ROOT, '.env.local');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(k in process.env)) process.env[k] = v;
  }
})();

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f) => { const i = argv.indexOf(f); return i > -1 ? argv[i + 1] : null; };
const COUNTRY = (arg('--country') || '').toLowerCase();
const EXECUTE = has('--execute') && !has('--dry-run');
const FORCE = has('--force');
const LIST = has('--list');
const PH_COUNTRY = (arg('--ph-country') || COUNTRY || '').toLowerCase();
const sfx = COUNTRY ? `_${COUNTRY.toUpperCase()}` : '';
const BASE = String(process.env[`AIROBASE_URL${sfx}`] || '').replace(/\/rest\/v1\/?$/, '').replace(/\/$/, '');
const KEY = process.env[`AIROBASE_SECRET_KEY${sfx}`];
if (!BASE || !KEY) { console.error(`[backfill-user-type] AIROBASE_URL${sfx} / AIROBASE_SECRET_KEY${sfx} missing`); process.exit(1); }

const H = { apikey: KEY, Authorization: `Bearer ${KEY}` };
async function rest(q, opts = {}) {
  const res = await fetch(`${BASE}/rest/v1/${q}`, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  if (!res.ok) { const e = new Error(`REST ${res.status} ${q.slice(0, 80)} :: ${(await res.text()).slice(0, 200)}`); e.status = res.status; throw e; }
  return res.status === 204 ? null : res.json();
}
async function all(table, query, size = 1000) {
  const out = [];
  for (let off = 0; ; off += size) {
    const rows = await rest(`${table}?${query}&limit=${size}&offset=${off}`);
    out.push(...rows);
    if (rows.length < size) return out;
  }
}
const inList = (xs) => `in.(${xs.map((x) => `"${String(x).replace(/"/g, '')}"`).join(',')})`;

async function posthogEvents() {
  const host = process.env.POSTHOG_HOST, project = process.env.POSTHOG_PROJECT_ID, key = process.env.POSTHOG_PERSONAL_API_KEY;
  if (has('--no-posthog') || !host || !project || !key) return { rows: [], used: false };
  const countryCond = PH_COUNTRY ? `and (properties.site_country = '${PH_COUNTRY.replace(/[^a-z]/g, '')}' or properties.site_country is null)` : '';
  const query = `select person.properties.email, distinct_id, event, min(timestamp) from events
    where event in (${SELL_SIGNUP_EVENTS.map((e) => `'${e}'`).join(',')}) ${countryCond}
    group by person.properties.email, distinct_id, event limit 50000`;
  const res = await fetch(`${host.replace(/\/$/, '')}/api/projects/${project}/query/`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { kind: 'HogQLQuery', query, modifiers: { personsOnEventsMode: 'person_id_override_properties_joined' } } }),
  });
  if (!res.ok) { console.warn(`[backfill-user-type] PostHog ${res.status} — continuing without it`); return { rows: [], used: false }; }
  const j = await res.json();
  return { rows: (j.results || []).map(([email, distinct_id, event, ts]) => ({ email, distinct_id, event, ts: ts && !String(ts).endsWith('Z') && !/[+-]\d\d:\d\d$/.test(ts) ? `${ts}Z` : ts })), used: true };
}

const mask = (e) => String(e || '').replace(/^(.{2}).*(@.*)$/, '$1…$2');

async function main() {
  console.log(`[backfill-user-type] db ${new URL(BASE).host.split('.')[0]} · country ${COUNTRY || '(default env)'} · ${EXECUTE ? 'EXECUTE (writes)' : 'DRY RUN (no writes)'}${FORCE ? ' · force' : ''}`);
  let columns = true;
  let users;
  try {
    users = await all('users', 'select=id,email,created_at,verified,auth_provider,user_type,user_type_source,first_listed_at&email=not.like.%25%40deleted.invalid&order=id.asc');
  } catch (e) {
    if (e.status !== 400 && e.status !== 404) throw e;
    columns = false;
    users = await all('users', 'select=id,email,created_at,verified,auth_provider&email=not.like.%25%40deleted.invalid&order=id.asc');
    if (EXECUTE) { console.error('[backfill-user-type] users.user_type is missing — run website migration 023_user_type.sql first.'); process.exit(2); }
    console.log('  (migration 023 not applied here: every account counts as having no type)');
  }
  const [props, drafts, emails, ph] = await Promise.all([
    all('properties', 'select=id,created_by,created_at,status&origin=eq.user&created_by=not.is.null&order=id.asc'),
    all('listing_drafts', 'select=id,user_id&order=id.asc').catch(() => []),
    all('email_log', `select=id,to_email,template_key,automation_id,created_at&template_key=${inList([...LISTED_TEMPLATES, ...DRAFT_TEMPLATES])}&order=id.asc`).catch(() => []),
    posthogEvents(),
  ]);
  console.log(`  read: ${users.length} accounts · ${props.length} user listings · ${drafts.length} drafts · ${emails.length} listing/draft emails · PostHog ${ph.used ? `${ph.rows.length} sell sign-up rows` : 'not used'}`);

  const evidence = buildEvidence({ users, props, drafts, emails, phEvents: ph.rows });
  const bySource = {};
  const groupsAfter = [];
  const patches = [];
  let alreadyTyped = 0;
  for (const u of users) {
    const v = classifyUser(u, evidence.get(String(u.id)));
    const patch = backfillPatch(u, v, { force: FORCE });
    if (u.user_type && !FORCE) alreadyTyped++;
    else bySource[v.source] = (bySource[v.source] || 0) + 1;
    const after = { ...u, ...(patch || {}) };
    groupsAfter.push(userTypeGroup(after, evidence.get(String(u.id)).listings.length));
    if (patch) patches.push({ u, v, patch });
    if (LIST) console.log(`  ${mask(u.email).padEnd(34)} ${String(u.verified ? 'verified' : 'unverified').padEnd(10)} ${(u.user_type || '-').padEnd(6)} → ${v.type.padEnd(6)} ${v.source}${patch ? '' : ' (no change)'}`);
  }
  const s = typeShares(groupsAfter);
  console.log('  verdicts for accounts without a type:', bySource);
  if (alreadyTyped) console.log(`  already had a type (kept): ${alreadyTyped}`);
  console.log(`  after the backfill: sellers ${s.counts.seller_listed + s.counts.seller_never_listed} (listed ${s.counts.seller_listed}, never listed ${s.counts.seller_never_listed}) · buyers ${s.counts.buyer + s.counts.buyer_listed} (who listed ${s.counts.buyer_listed}) · unknown ${s.counts.unknown}`);
  console.log(`  = ${s.pctSellers}% sellers / ${s.pctBuyers}% buyers · ${s.pctSellersNeverListed}% of sellers never listed`);
  console.log(`  rows to update: ${patches.length} (first_listed_at to fill: ${patches.filter((p) => p.patch.first_listed_at).length})`);

  if (!EXECUTE) { console.log('  dry run — nothing written. Add --execute to write.'); return; }
  if (!columns) return;
  let ok = 0, failed = 0;
  for (const { u, patch } of patches) {
    // only an account still without a type is typed (unless --force); first_listed_at only when empty
    const typePart = patch.user_type ? { user_type: patch.user_type, user_type_source: patch.user_type_source, user_type_at: patch.user_type_at } : null;
    try {
      if (typePart) await rest(`users?id=eq.${u.id}${FORCE ? '' : '&user_type=is.null'}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(typePart) });
      if (patch.first_listed_at) await rest(`users?id=eq.${u.id}&first_listed_at=is.null`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ first_listed_at: patch.first_listed_at }) });
      ok++;
    } catch (e) { failed++; console.error(`  ! ${mask(u.email)}: ${e.message}`); }
  }
  console.log(`  written: ${ok} · failed: ${failed}`);
}

main().catch((e) => { console.error('[backfill-user-type] failed:', e.message); process.exit(1); });
