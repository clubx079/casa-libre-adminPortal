// END TO END — the Inbox assistant's sales reply (rule 1) and window-closing follow-up (rule 2)
// with made-up people, against the SANDBOX database.
//   npx vitest run --config scripts/e2e/vitest.e2e.config.mjs                     Claude stand-in
//   E2E_REAL_CLAUDE=1 npx vitest run --config scripts/e2e/vitest.e2e.config.mjs   real Claude (a few cents)
// The Claude stand-in answers at the HTTP level (api.anthropic.com), so everything else runs for
// real: the sorter, the rules, the fact sheet, the tracked links, email_log, the AI usage log.
// WhatsApp is a stand-in (an in-memory Relay): nothing can reach a real phone, and mark-as-read
// (/read) or a live-mode call makes the run fail. It refuses to start unless every country DB
// in the env is the sandbox (7c73a09c…) and INBOX_RELAY_MODE=test. The rows it writes (email_log
// for the made-up numbers, one test user + payment) are deleted at the end.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

const SANDBOX = '7c73a09c7a1c4793b081';
const PY_LIVE = 'd34d50f3';
const hosts = Object.entries(process.env).filter(([k]) => /^AIROBASE_URL/.test(k)).map(([k, v]) => [k, String(v)]);
if (!hosts.length || hosts.some(([, v]) => v.includes(PY_LIVE) || !v.includes(SANDBOX))) throw new Error(`refusing to run: DB hosts ${JSON.stringify(hosts.map(([k, v]) => `${k}=${v.replace(/^https?:\/\//, '').split('.')[0]}`))}`);
if (process.env.INBOX_RELAY_MODE !== 'test') throw new Error('refusing to run: INBOX_RELAY_MODE must be test');
const REAL_CLAUDE = process.env.E2E_REAL_CLAUDE === '1';
if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = 'e2e-stand-in';   // autoEnabled() needs one

// ── the Claude stand-in (only api.anthropic.com is answered here; everything else goes out) ──
const { inboundKind } = await import('../../lib/waInboundKind.js');
const claudeCalls = [];
if (!REAL_CLAUDE) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(typeof input === 'string' ? input : input?.url || '');
    if (!url.startsWith('https://api.anthropic.com/')) return realFetch(input, init);
    const body = JSON.parse(init.body);
    const NL = String.fromCharCode(10);
    const user = typeof body.messages[0].content === 'string' ? body.messages[0].content : body.messages[0].content.map((c) => c.text).join(NL);
    const system = typeof body.system === 'string' ? body.system : (body.system || []).map((x) => x.text).join(NL);
    let out;
    if (system.startsWith('You sort incoming WhatsApp messages')) {
      const items = JSON.parse(user.slice(user.indexOf('[')));
      out = { items: items.map((x) => ({ id: x.id, kind: inboundKind({ text: x.text }, { secondsAfterOurs: x.seconds_after_ours }).kind.replace('button', 'keyword').replace('media', 'text'), reason: 'stand-in' })) };
    } else {
      const mode = /FOLLOW-UP MODE/.test(user) ? 'window' : /SALES MODE/.test(user) ? 'sale' : 'answer';
      const links = user.slice(user.indexOf('FACT SHEET')).match(/https:\/\/[^"\s]+\/r\/ai\?[^"\s]+/g) || [];   // the fact sheet's links, as the prompt says
      const link = links.find((l) => /u=\/publicar/.test(l)) || links.find((l) => /u=\/cuenta/.test(l)) || links[0] || '';
      const message = mode === 'answer' ? `Publicar es gratis para tus primeras propiedades del mes, con 0% de comisión. Publicala hoy:
${link}`
        : mode === 'sale' ? `¡Gracias a vos! Los compradores están buscando ahora mismo: publicá tu propiedad hoy, es gratis y toma 2 minutos.
${link}`
          : `No lo dejes para después: hoy hay compradores buscando en tu zona. Publicá tu propiedad gratis en 2 minutos.
${link}`;
      out = { message, english: '(stand-in) ' + mode, note: '', action: 'send', topic: mode === 'answer' ? 'listing price' : 'sales follow-up', reason: 'stand-in', goal: 'publish', holding: '', portfolio: 0 };
    }
    claudeCalls.push({ model: body.model, kind: system.startsWith('You sort') ? 'classify' : 'reply' });
    return new Response(JSON.stringify({ id: `msg_standin${claudeCalls.length}`, type: 'message', role: 'assistant', model: body.model, content: [{ type: 'text', text: JSON.stringify(out) }], stop_reason: 'end_turn', usage: { input_tokens: Math.round(user.length / 4), output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
}

const { handleInbound } = await import('../../lib/inboxAuto.js');
const { runWindowFollowUps } = await import('../../lib/inboxWindow.js');
const { dbFor } = await import('../../lib/db.js');
const db = dbFor('py');

const H = 3600000;
const NOW = Date.now();
const iso = (hoursAgo) => new Date(NOW - hoursAgo * H).toISOString();
const P = { thanks: '595999770001', reaction: '595999770002', question: '595999770003', baja: '595999770004', window: '595999770005', done: '595999770006', robot: '595999770007' };
let seq = 0;
const id = () => `msg_e2e${Date.now().toString(36)}${(seq++).toString(36)}`;

// ── the in-memory Relay ───────────────────────────────────────────────────────────────────────
const chats = new Map();
const calls = [];
const sentTexts = [];
function chat(phone, { tags = ['site-py'], opt = 'unknown', name = null } = {}) {
  const c = { conv: { object: 'conversation', phone: `+${phone}`, name, status: 'open', tags: [...tags], unread_count: 0, opt_in_status: opt, window: { open: true, expires_at: null }, last_inbound_at: null }, messages: [] };
  chats.set(phone, c);
  return c;
}
function add(phone, m) {
  const c = chats.get(phone);
  const msg = { object: 'message', id: m.id || id(), direction: m.direction, type: m.type || 'text', text: m.text ?? null, template: m.template || null, sent_by: m.direction === 'outbound' ? (m.sent_by || 'api') : null, status: m.direction === 'outbound' ? 'delivered' : 'received', timestamps: { created: m.at || new Date().toISOString() } };
  c.messages.push(msg);
  const lastIn = c.messages.filter((x) => x.direction === 'inbound').map((x) => Date.parse(x.timestamps.created)).sort((a, b) => b - a)[0];
  if (lastIn) { c.conv.last_inbound_at = new Date(lastIn).toISOString(); c.conv.window = { open: lastIn + 24 * H > Date.now(), expires_at: new Date(lastIn + 24 * H).toISOString() }; }
  c.conv.last_message = msg;
  return msg;
}
const ok = (data) => ({ ok: true, status: 200, data });
async function R(mode, path, { method = 'GET', json } = {}) {
  calls.push({ mode, method, path });
  if (mode !== 'test') throw new Error(`live Relay mode used: ${method} ${path}`);
  if (/\/read(\?|$)/.test(path)) throw new Error(`mark-as-read called: ${path}`);
  let m;
  if (method === 'GET' && (m = path.match(/^\/conversations\/(\d+)\/messages/))) {
    const c = chats.get(m[1]);
    return c ? ok({ object: 'list', data: [...c.messages].sort((a, b) => Date.parse(b.timestamps.created) - Date.parse(a.timestamps.created)) }) : { ok: false, status: 404, data: {} };
  }
  if (method === 'GET' && (m = path.match(/^\/conversations\/(\d+)$/))) { const c = chats.get(m[1]); return c ? ok(c.conv) : { ok: false, status: 404, data: {} }; }
  if (method === 'PATCH' && (m = path.match(/^\/conversations\/(\d+)$/))) {
    const c = chats.get(m[1]);
    for (const t of json?.add_tags || []) if (!c.conv.tags.includes(t)) c.conv.tags.push(t);
    return ok(c.conv);
  }
  if (method === 'POST' && path === '/messages/text') {
    const phone = String(json.to).replace(/\D/g, '');
    const msg = add(phone, { direction: 'outbound', text: json.text });
    sentTexts.push({ phone, text: json.text });
    return ok({ id: msg.id });
  }
  throw new Error(`unexpected Relay call ${method} ${path}`);
}
// an earlier answer from the assistant: in the chat AND in email_log (as the live flow records it)
async function aiSaid(phone, text, hoursAgo) {
  const m = add(phone, { direction: 'outbound', text, at: iso(hoursAgo) });
  await db.insert('email_log', [{ automation_id: 'inbox_ai', channel: 'whatsapp', to_email: '', to_phone: `+${phone}`, subject: 'e2e earlier answer', status: 'sent', relay_message_id: m.id, dedupe_key: `ai:e2e-${m.id}`, error: JSON.stringify({ inbound_id: 'e2e', covers: [] }) }], { returning: 'minimal' });
  return m;
}
const outbound = (phone) => chats.get(phone).messages.filter((m) => m.direction === 'outbound');
const event = (phone, msg) => ({ ...msg, from: `+${phone}`, phone });
const logRows = (phone) => db.select('email_log', `select=id,automation_id,template_key,status,dedupe_key,relay_message_id,error,created_at&to_phone=eq.${encodeURIComponent(`+${phone}`)}&order=created_at.asc`);

let testUser = null;
async function cleanup() {
  for (const p of Object.values(P)) await db.remove('email_log', `to_phone=eq.${encodeURIComponent(`+${p}`)}`).catch(() => {});
  if (testUser) await db.remove('users', `id=eq.${testUser.id}`).catch(() => {});   // payments cascade
  await db.remove('users', `email=eq.${encodeURIComponent('e2e-window-done@casa-libre.test')}`).catch(() => {});
}

beforeAll(async () => {
  console.log('[e2e] Claude:', REAL_CLAUDE ? 'REAL' : 'stand-in');
  console.log('[e2e] DB hosts:', hosts.map(([k, v]) => `${k}=${v.replace(/^https?:\/\//, '').split('.')[0]}`).join(' '), '· Relay: in-memory stand-in (test mode)');
  await cleanup();
});
afterAll(async () => {
  await cleanup();
  console.log('[e2e] messages the assistant wrote:\n' + sentTexts.map((s) => `  …${s.phone.slice(-4)}: ${s.text.replace(/\n/g, ' ⏎ ')}`).join('\n'));
});

describe('rule 1 — not a question → one sales reply', () => {
  it('thanks → ONE sales reply, logged, links tagged ack…', async () => {
    chat(P.thanks);
    add(P.thanks, { direction: 'inbound', text: 'Hola, ¿cómo publico mi casa en Luque?', at: iso(0.2) });
    await aiSaid(P.thanks, '¡Hola! Publicar es muy fácil… https://casa-libre.com.py/r/ai?u=/publicar&r=x&a=y', 0.19);
    const t1 = add(P.thanks, { direction: 'inbound', text: 'Muchas gracias!', at: iso(0.01) });
    const res = await handleInbound(event(P.thanks, t1), { relayImpl: R });
    expect(res).toMatchObject({ kind: 'ack', action: 'sent' });
    expect(outbound(P.thanks)).toHaveLength(2);
    const text = outbound(P.thanks)[1].text;
    expect(text).not.toMatch(/\p{Extended_Pictographic}/u);
    for (const url of text.match(/https?:\/\/\S+/g) || []) expect(url).toMatch(/\/r\/ai\?u=.*&a=ack/);
    const rows = await logRows(P.thanks);
    expect(rows.filter((r) => r.template_key === 'ai_sale')).toHaveLength(1);
    expect(rows.find((r) => r.template_key === 'ai_sale')).toMatchObject({ automation_id: 'inbox_ai', status: 'sent', dedupe_key: `aisale:${t1.id}` });
  });

  it('second thanks → no reply (no gracias loop)', async () => {
    const t2 = add(P.thanks, { direction: 'inbound', text: 'Excelente, gracias', at: new Date().toISOString() });
    const res = await handleInbound(event(P.thanks, t2), { relayImpl: R });
    expect(res.action).toBe('skipped');
    expect(res.reason).toBe('sale_already_sent');
    expect(outbound(P.thanks)).toHaveLength(2);
  });

  it('the same thanks handed over twice (webhook + poller / restart) → still one reply', async () => {
    const t1 = chats.get(P.thanks).messages.find((m) => m.text === 'Muchas gracias!');
    const res = await handleInbound(event(P.thanks, t1), { relayImpl: R });
    expect(res.action).not.toBe('sent');
    expect(outbound(P.thanks)).toHaveLength(2);
  });

  it('a reaction (heart) → one sales reply', async () => {
    chat(P.reaction);
    add(P.reaction, { direction: 'inbound', text: '¿Es gratis publicar?', at: iso(0.3) });
    await aiSaid(P.reaction, '¡Sí! Tus primeras publicaciones del mes son gratis. https://casa-libre.com.py/r/ai?u=/publicar&r=x&a=z', 0.29);
    const r1 = add(P.reaction, { direction: 'inbound', type: 'reaction', text: null, at: iso(0.01) });
    const res = await handleInbound(event(P.reaction, r1), { relayImpl: R });
    expect(res).toMatchObject({ kind: 'emoji', action: 'sent' });
    expect(outbound(P.reaction)).toHaveLength(2);
  });

  it('a question is still answered as a question', async () => {
    chat(P.question);
    const q = add(P.question, { direction: 'inbound', text: '¿Cuánto cuesta publicar un terreno en Asunción?', at: iso(0.01) });
    const res = await handleInbound(event(P.question, q), { relayImpl: R });
    expect(['sent', 'sent_and_person']).toContain(res.action);
    const rows = await logRows(P.question);
    expect(rows.some((r) => r.automation_id.startsWith('inbox_ai') && !['ai_sale', 'ai_window'].includes(r.template_key))).toBe(true);
  });

  it('BAJA → nothing (the website handles the keyword; a thanks after it gets nothing either)', async () => {
    chat(P.baja, { opt: 'opted_out' });
    add(P.baja, { direction: 'outbound', text: '', template: { name: 'cl_agentes_mascota' }, at: iso(1) });
    const b = add(P.baja, { direction: 'inbound', text: 'BAJA', at: iso(0.5) });
    const r1 = await handleInbound(event(P.baja, b), { relayImpl: R });
    expect(r1.action).toBe('website');
    const t = add(P.baja, { direction: 'inbound', text: 'gracias', at: iso(0.01) });
    const r2 = await handleInbound(event(P.baja, t), { relayImpl: R });
    expect(r2.action).toBe('skipped');
    expect(['opted_out', 'asked_to_stop']).toContain(r2.reason);
    expect(outbound(P.baja)).toHaveLength(1);   // only our campaign template
  });
});

describe('rule 2 — the window-closing follow-up', () => {
  beforeAll(async () => {
    // F: asked how to publish 22 h ago, we answered, they said thanks 21 h ago — no account, no action
    chat(P.window);
    add(P.window, { direction: 'inbound', text: 'Hola, quiero publicar un departamento en Lambaré, ¿cómo hago?', at: iso(22) });
    await aiSaid(P.window, '¡Hola! Es muy fácil… https://casa-libre.com.py/r/ai?u=/publicar&r=x&a=q', 21.9);
    add(P.window, { direction: 'inbound', text: 'Gracias, lo veo', at: iso(21) });
    // G: the same, but they DID act since: an account + a paid listing an hour ago (made-up user in the sandbox)
    chat(P.done);
    add(P.done, { direction: 'inbound', text: 'Hola, ¿cómo publico mi casa en Capiatá?', at: iso(22) });
    await aiSaid(P.done, '¡Hola! Publicala acá… https://casa-libre.com.py/r/ai?u=/publicar&r=x&a=w', 21.9);
    add(P.done, { direction: 'inbound', text: 'Dale', at: iso(21) });
    [testUser] = await db.insert('users', [{ email: 'e2e-window-done@casa-libre.test', full_name: 'E2E Ventana (prueba)', phone: `+${P.done}`, created_at: iso(24 * 30), verified: true }]);
    await db.insert('payments', [{ user_id: testUser.id, kind: 'listing', amount_usd: 5.8, status: 'succeeded', created_at: iso(1) }], { returning: 'minimal' });
    // R: a window opened only by an agency's auto-greeting after our campaign
    chat(P.robot);
    add(P.robot, { direction: 'outbound', text: '', template: { name: 'cl_agentes_mascota' }, at: iso(21.2) });
    add(P.robot, { direction: 'inbound', text: 'Gracias por comunicarte con Inmobiliaria Prueba S.A. En breve te responderemos. Horario de atención: lunes a viernes de 8 a 17 h.', at: iso(21.19) });
  });

  const list = () => [P.window, P.done, P.robot].map((p) => chats.get(p).conv);

  it('21 h, no action → ONE follow-up (tagged win…); with the action → none; robot → none', async () => {
    const r = await runWindowFollowUps({ list: list(), R });
    const by = Object.fromEntries(r.results.map((x) => [x.phone, x]));
    expect(by[P.window]).toMatchObject({ action: 'sent' });
    expect(by[P.done]).toMatchObject({ action: 'skipped', reason: 'goal_done' });
    expect(by[P.robot]).toMatchObject({ action: 'skipped', reason: 'robot_only' });
    expect(outbound(P.window)).toHaveLength(2);
    expect(outbound(P.done)).toHaveLength(1);
    expect(outbound(P.robot)).toHaveLength(1);
    const text = outbound(P.window)[1].text;
    for (const url of text.match(/https?:\/\/\S+/g) || []) expect(url).toMatch(/\/r\/ai\?u=.*&a=win/);
    const rows = await logRows(P.window);
    expect(rows.filter((x) => x.template_key === 'ai_window')).toHaveLength(1);
    const w = rows.find((x) => x.template_key === 'ai_window');
    expect(w).toMatchObject({ automation_id: 'inbox_ai', status: 'sent' });
    expect(w.dedupe_key).toMatch(/^aiwin:595999770005:/);
  });

  it('restart (fresh process state) → no duplicate', async () => {
    delete globalThis.__clWindowRun;
    const r = await runWindowFollowUps({ list: list(), R });
    expect(r.sent).toBe(0);
    expect(r.results.find((x) => x.phone === P.window)).toMatchObject({ action: 'skipped', reason: 'already_sent' });
    expect(outbound(P.window)).toHaveLength(2);
  });

  it('never used live Relay or mark-as-read', () => {
    expect(calls.every((c) => c.mode === 'test')).toBe(true);
    expect(calls.some((c) => /\/read/.test(c.path))).toBe(false);
  });
});
