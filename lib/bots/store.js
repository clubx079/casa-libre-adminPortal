// Bots: connections and runs in the CONTROL DB (migrations/control/003_bots.sql), and the call to a
// Grok Bot routine's webhook. Server-only. The webhook key never leaves the server.
import 'server-only';
import crypto from 'crypto';
import { buildJob, runView, parseReport, BOT_KEYS } from './job.js';

let _ctrl = null;
async function ctrl() {
  if (!process.env.CONTROL_DB_URL || !process.env.CONTROL_DB_KEY) throw new Error('Control DB not configured');
  if (!_ctrl) { const { makeClient } = await import('../db.js'); _ctrl = makeClient(process.env.CONTROL_DB_URL, process.env.CONTROL_DB_KEY); }
  return _ctrl;
}
const enc = encodeURIComponent;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const isMissingTable = (e) => ['42P01', 'PGRST205', 'PGRST204'].includes(e?.code) || /does not exist|schema cache|Could not find the table/i.test(String(e?.message || ''));
export const reportUrl = () => `${(process.env.ADMIN_PUBLIC_URL || 'https://admin.casa-libre.com').replace(/\/$/, '')}/api/bot-report`;
const validKey = (k) => BOT_KEYS.includes(k);

// overview for the page: per bot → connected?, last test, latest runs (no secrets)
export async function overview() {
  const db = await ctrl();
  const [conns, runs] = await Promise.all([
    db.select('bot_connections', 'select=bot_key,webhook_url,connected_at,connected_by,last_test_at,last_test_ok'),
    db.select('bot_runs', 'select=id,bot_key,trigger,status,summary,items,item_count,error,approval,approved_by,created_by,started_at,reported_at&order=started_at.desc&limit=300'),
  ]);
  const out = {};
  for (const k of BOT_KEYS) {
    const c = conns.find((x) => x.bot_key === k);
    out[k] = {
      connected: !!c,
      connection: c ? { connectedAt: c.connected_at, by: c.connected_by, host: (() => { try { return new URL(c.webhook_url).host; } catch { return null; } })(), lastTestAt: c.last_test_at, lastTestOk: c.last_test_ok } : null,
      runs: runs.filter((r) => r.bot_key === k).slice(0, 50).map((r) => runView(r)),
    };
  }
  return out;
}

export async function saveConnection(key, { url, webhookKey }, by) {
  if (!validKey(key)) throw Object.assign(new Error('unknown bot'), { status: 400 });
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw Object.assign(new Error('The "POST to" address is not a valid URL.'), { status: 400 }); }
  if (u.protocol !== 'https:') throw Object.assign(new Error('The "POST to" address must start with https://'), { status: 400 });
  const k = String(webhookKey || '').trim().replace(/^Authorization:\s*/i, '').replace(/^Bearer\s+/i, '');
  if (k.length < 16) throw Object.assign(new Error('The key looks too short. Copy the "key" field of the routine.'), { status: 400 });
  const db = await ctrl();
  await db.insert('bot_connections', [{ bot_key: key, webhook_url: u.toString(), webhook_key: k, connected_at: new Date().toISOString(), connected_by: by || null, last_test_at: null, last_test_ok: null }], { upsert: true, onConflict: 'bot_key', returning: 'minimal' });
}

export async function removeConnection(key) {
  if (!validKey(key)) throw Object.assign(new Error('unknown bot'), { status: 400 });
  await (await ctrl()).remove('bot_connections', `bot_key=eq.${enc(key)}`);
}

// Send a job (test or real) to the bot's routine webhook; the run is recorded first.
export async function startRun(key, { settings = null, test = false, by = null } = {}) {
  if (!validKey(key)) throw Object.assign(new Error('unknown bot'), { status: 400 });
  const db = await ctrl();
  const [conn] = await db.select('bot_connections', `select=*&bot_key=eq.${enc(key)}&limit=1`);
  if (!conn) throw Object.assign(new Error('This bot is not connected yet. Add its webhook in the Connection tab.'), { status: 400 });
  const runId = crypto.randomUUID();
  const token = crypto.randomBytes(32).toString('hex');
  const job = buildJob(key, settings, { runId, reportTo: reportUrl(), token, test });
  const stored = { ...job, reportHeader: 'Authorization: Bearer ••••' };
  await db.insert('bot_runs', [{ id: runId, bot_key: key, trigger: test ? 'test' : 'manual', status: 'sent', token_hash: sha(token), request: stored, created_by: by }], { returning: 'minimal' });
  let ok = false; let error = null;
  try {
    const r = await fetch(conn.webhook_url, {
      method: 'POST', headers: { Authorization: `Bearer ${conn.webhook_key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(job), signal: AbortSignal.timeout(20000),
    });
    ok = r.ok;
    if (!ok) error = `Grok answered ${r.status}${r.status === 401 || r.status === 403 ? ' (wrong key?)' : r.status === 404 ? ' (wrong address, or the routine was deleted)' : r.status === 429 ? ' (rate limit)' : ''}: ${(await r.text().catch(() => '')).slice(0, 200)}`;
  } catch (e) { error = `Could not reach Grok: ${String(e?.message || e).slice(0, 200)}`; }
  if (!ok) await db.update('bot_runs', `id=eq.${runId}`, { status: 'failed', error }, { returning: 'minimal' });
  if (test) await db.update('bot_connections', `bot_key=eq.${enc(key)}`, { last_test_at: new Date().toISOString(), last_test_ok: ok ? null : false }, { returning: 'minimal' });
  return { runId, started: ok, error };
}

// The bot reports back (public endpoint, one-time token).
export async function receiveReport(body, bearer) {
  const p = parseReport(body);
  if (p.error) throw Object.assign(new Error(p.error), { status: 400 });
  const db = await ctrl();
  const [run] = await db.select('bot_runs', `select=id,bot_key,trigger,status,token_hash&id=eq.${p.runId}&limit=1`);
  const given = sha(bearer || '');
  const want = String(run?.token_hash || '');
  if (!run || want.length !== given.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(want))) throw Object.assign(new Error('unknown run or wrong token'), { status: 401 });
  if (run.status === 'done') return { ok: true, already: true };
  await db.update('bot_runs', `id=eq.${p.runId}`, {
    status: p.failed ? 'failed' : 'done', summary: p.summary || null, items: p.items, item_count: p.items.length,
    error: p.failed ? (p.summary || 'The bot reported a failure') : null,
    approval: run.trigger === 'test' || !p.items.length ? 'none' : 'pending', reported_at: new Date().toISOString(),
  }, { returning: 'minimal' });
  if (run.trigger === 'test') await db.update('bot_connections', `bot_key=eq.${enc(run.bot_key)}`, { last_test_ok: !p.failed }, { returning: 'minimal' });
  // AI visibility answers → ai_visibility_answers (the AI SEO pipeline reads them)
  if (run.bot_key === 'visibility' && run.trigger !== 'test' && !p.failed) import('../aiVisibility/run.js').then((m) => m.ingestBotRuns({ limit: 1 })).catch(() => {});
  return { ok: true };
}

export async function setApproval(id, approval, by) {
  if (!/^[0-9a-f-]{36}$/i.test(id) || !['approved', 'rejected'].includes(approval)) throw Object.assign(new Error('bad request'), { status: 400 });
  await (await ctrl()).update('bot_runs', `id=eq.${id}`, { approval, approved_by: by || null }, { returning: 'minimal' });
}
