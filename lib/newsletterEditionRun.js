// The weekly newsletter EDITION generator — the I/O (lib/newsletterEditionCore.js has the rules).
//   • Automatic: the hourly security cron (/api/cron/security?country=…) calls startEditionIfDue:
//     when the admin switched "Auto-generate" on (Automations → Weekly newsletter) and it is
//     LEAD_HOURS before the weekly email (or later that week), it claims the week in
//     newsletter_editions (status 'generating' — a unique index allows one per week) and writes
//     the edition in the background.
//   • "Generate now" (the same card) → startEditionIfDue(country, { force: true }).
// Writing: this week's numbers (PostHog + the country DB, the website's own formulas), then
// Claude writes 12 new stories, then 2–3 articles around the numbers and the stories. Each
// answer is validated; one repair round with the list of broken rules; still invalid → the
// row becomes 'failed' (nothing published; up to MAX_ATTEMPTS tries that week, then the week is
// skipped and the email goes with the rotation as before). Valid → 'published': the website shows
// it at /newsletter and that week's email uses it. Server only.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { dbFor } from './db';
import { claudeClient } from './aiTrack';
import { hogql, posthogConfigured } from './posthogHogql';
import { insightVars } from './newsletterInsightsCore';
import { NEWSLETTER_ID, newsletterSettings } from './newsletterAdmin';
import {
  editionDue, editionSlot, usedBefore, validateStories, validateIssues, validateEdition, parseJson, isStale,
  SYSTEM, STORIES_SCHEMA, ISSUES_SCHEMA, storiesPrompt, issuesPrompt, repairPrompt,
} from './newsletterEditionCore';

export const TABLE = 'newsletter_editions';
export const EDITION_MODEL = process.env.NEWSLETTER_MODEL || 'claude-opus-5-5';
const FALLBACK = { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' };

// ── this week's numbers (same queries as the website's lib/newsletter/insights.js) ──
const SITE = String.raw`multiIf(
    coalesce(properties.site_country, '') != '', lower(properties.site_country),
    match(coalesce(properties.$host, ''), '(?i)casa-libre\\.com\\.bo'), 'bo',
    match(coalesce(properties.$host, ''), '(?i)(^|\\.)uy\\.casa-libre\\.com'), 'uy',
    match(coalesce(properties.$host, ''), '(?i)casa-libre\\.com\\.ve'), 've',
    match(coalesce(properties.$host, ''), '(?i)(^|\\.)sv\\.casa-libre\\.com'), 'sv',
    'py')`;
const UKEY = `if(coalesce(person.properties.email, '') != '', toString(person_id), coalesce(nullIf(properties.$ip, ''), 'unknown'))`;

export async function measureInsights(country, db = dbFor(country)) {
  const where = `timestamp >= now() - INTERVAL 30 DAY AND timestamp < now() AND coalesce(properties.$geoip_country_name, '') != 'Pakistan' AND ${SITE} = '${country}'`;
  const raw = { totals: [], listings: [], searches: {}, queries: [] };
  const live = await db.selectWithCount('properties', 'select=id&admin_status=eq.active&limit=1').catch(() => ({ count: 0 }));
  raw.activeListings = live.count || 0;
  if (!posthogConfigured()) return insightVars(raw);
  const q = (s) => hogql(s, { fresh: 30 * 60_000 }).catch(() => []);
  const [totals, per, ops, queries] = await Promise.all([
    q(`SELECT count(), uniqExact(${UKEY}) FROM events WHERE event = 'property_viewed' AND ${where}`),
    q(`SELECT toString(properties.property_id) AS pid, count() AS v FROM events WHERE event = 'property_viewed' AND ${where} GROUP BY pid ORDER BY v DESC LIMIT 5000`),
    q(`SELECT toString(properties.operation) AS op, count() FROM events WHERE event = 'search_applied' AND ${where} GROUP BY op`),
    q(`SELECT toString(properties.query) AS q, count() AS n FROM events WHERE event = 'search_applied' AND ${where} AND coalesce(toString(properties.query), '') != '' GROUP BY q ORDER BY n DESC LIMIT 60`),
  ]);
  raw.totals = totals[0] || [];
  for (const [op, n] of ops) { if (op === 'alquiler') raw.searches.rent = Number(n) || 0; if (op === 'venta') raw.searches.sale = Number(n) || 0; }
  raw.queries = queries;
  const views = new Map(per.filter(([pid]) => /^[0-9a-f-]{36}$/i.test(String(pid))).map(([pid, v]) => [String(pid), Number(v) || 0]));
  const ids = [...views.keys()];
  for (let i = 0; i < ids.length; i += 150) {
    const rows = await db.select('properties', `select=id,price_usd,listing_type,city,property_type,origin,feature_image_url,additional_photos&id=in.(${ids.slice(i, i + 150).join(',')})`).catch(() => []);
    for (const p of rows) {
      raw.listings.push({
        views: views.get(String(p.id)) || 0, price_usd: p.price_usd, listing_type: p.listing_type, city: p.city, property_type: p.property_type, origin: p.origin,
        photos: (p.feature_image_url ? 1 : 0) + (Array.isArray(p.additional_photos) ? p.additional_photos.length : 0),
      });
    }
  }
  return insightVars(raw);
}

// ── Claude ──
async function askJson(client, { prompt, schema, repair = null }) {
  const messages = [{ role: 'user', content: prompt }];
  if (repair) messages.push({ role: 'assistant', content: repair.previous }, { role: 'user', content: repairPrompt(repair.errors) });
  const params = {
    model: EDITION_MODEL, max_tokens: 32000, system: SYSTEM, thinking: { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema } }, messages,
  };
  let msg;
  try { msg = await client.beta.messages.stream({ ...params, ...FALLBACK }).finalMessage(); }
  catch (e) {
    if (!(e instanceof Anthropic.BadRequestError && /fallback/i.test(String(e.message)))) throw e;
    msg = await client.messages.stream(params).finalMessage();
  }
  if (msg.stop_reason === 'refusal') throw new Error(`Claude declined (${msg.stop_details?.category || 'no category'})`);
  if (msg.stop_reason === 'max_tokens') throw new Error('Claude was cut off (max_tokens)');
  const text = (msg.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
  return { json: parseJson(text), text, model: msg.model || EDITION_MODEL };
}

// ask → validate → one repair round → validate. → { ok, value, errors, model }
async function askValid(client, { prompt, schema, pick, check }) {
  let a = await askJson(client, { prompt, schema });
  let v = check(pick(a.json));
  if (v.ok) return { ...v, model: a.model };
  a = await askJson(client, { prompt, schema, repair: { previous: a.text, errors: v.errors } });
  v = check(pick(a.json));
  return { ...v, model: a.model };
}

// Write one edition (no DB writes). deps for tests / the dry run: { vars, editions, client, now }.
export async function writeEdition(country, { vars, editions = [], client, now = new Date() } = {}) {
  const { week, date } = editionSlot(now, country);
  const used = usedBefore(editions);
  const ai = client || await claudeClient({ feature: 'newsletter_edition', country }, { timeout: 280000, maxRetries: 1 });
  const s = await askValid(ai, {
    prompt: storiesPrompt({ country, vars, used, date }), schema: STORIES_SCHEMA,
    pick: (j) => j?.stories, check: (list) => validateStories(list, { country, used }),
  });
  if (!s.ok) return { ok: false, errors: s.errors.map((e) => `stories — ${e}`), week, date };
  const storySlugs = s.stories.map((x) => x.slug);
  const i = await askValid(ai, {
    prompt: issuesPrompt({ country, vars, stories: s.stories, date }), schema: ISSUES_SCHEMA,
    pick: (j) => (Array.isArray(j?.issues) ? j.issues.map((x) => ({ ...x, story: x.story || undefined })) : j?.issues),
    check: (list) => validateIssues(list, { country, vars, storySlugs }),
  });
  if (!i.ok) return { ok: false, errors: i.errors.map((e) => `issues — ${e}`), week, date };
  const v = validateEdition({ issues: i.issues, stories: s.stories }, { country, vars, used, week, date });
  return { ...v, week, date, model: i.model || s.model };
}

// ── the run ──
const running = (globalThis.__clEditionRunning ||= new Set());

async function loadState(db, week) {
  const [[row], rows] = await Promise.all([
    db.select('automations', `select=*&id=eq.${NEWSLETTER_ID}&limit=1`).catch(() => []),
    db.select(TABLE, `select=id,week,status,created_at&week=eq.${encodeURIComponent(week)}`),
  ]);
  return { settings: newsletterSettings(row || null), rows };
}

// → { started, week } | { started: false, reason }
export async function startEditionIfDue(country, { force = false, now = new Date(), wait = false } = {}) {
  const db = dbFor(country);
  const { week } = editionSlot(now, country);
  if (running.has(`${country}|${week}`)) return { started: false, reason: 'generating', week };
  let st;
  try { st = await loadState(db, week); } catch (e) { return { started: false, reason: 'no_table', error: String(e?.message || e).slice(0, 200) }; }
  const due = editionDue({ settings: st.settings, rows: st.rows, now, country, force });
  if (!due.due) return { started: false, reason: due.reason, week };
  if (!force && !process.env.ANTHROPIC_API_KEY) return { started: false, reason: 'no_key', week };
  // a crashed run's claim is released; then the week is claimed (one 'generating'/'published' per week)
  for (const r of st.rows.filter((x) => x.status === 'generating' && isStale(x, now))) {
    await db.update(TABLE, `id=eq.${r.id}`, { status: 'failed', error: 'timed out (crashed run)' }, { returning: 'minimal' }).catch(() => {});
  }
  let claim;
  try { [claim] = await db.insert(TABLE, [{ week, date: due.date, status: 'generating', issues: [], stories: [] }]); }
  catch (e) { return { started: false, reason: e?.code === '23505' || e?.status === 409 ? 'generating' : 'claim_failed', week, error: String(e?.message || e).slice(0, 200) }; }
  const key = `${country}|${week}`;
  running.add(key);
  const job = (async () => {
    try {
      if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY not set');
      const vars = await measureInsights(country, db);
      const editions = await db.select(TABLE, 'select=stories&status=eq.published&order=date.desc&limit=200').catch(() => []);
      const r = await writeEdition(country, { vars, editions, now });
      if (!r.ok) throw new Error(r.errors.slice(0, 12).join(' | '));
      await db.update(TABLE, `id=eq.${claim.id}`, {
        status: 'published', date: r.edition.date, issues: r.edition.issues, stories: r.edition.stories,
        vars, model: r.model, error: null, published_at: new Date().toISOString(),
      }, { returning: 'minimal' });
      return { ok: true, week, date: r.edition.date };
    } catch (e) {
      const error = String(e?.message || e).slice(0, 2000);
      await db.update(TABLE, `id=eq.${claim.id}`, { status: 'failed', error }, { returning: 'minimal' }).catch(() => {});
      console.error('[newsletter edition]', country, week, error);
      return { ok: false, week, error };
    } finally { running.delete(key); }
  })();
  if (wait) return { started: true, week, ...(await job) };
  return { started: true, week };
}
