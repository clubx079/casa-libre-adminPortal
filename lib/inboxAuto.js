// The Inbox assistant answering by itself (admin Relay webhook, app/api/relay/webhook):
// an inbound WhatsApp message → sorted (lib/waInboundKind.js) → the guards
// (lib/inboxAutoRules.js) → the fact sheet for that person (lib/aiContext.js) → Claude in
// AUTO MODE (lib/aiPrompt.js) decides "send" (a fact we hold: sent at once) or "person"
// (tagged "needs-a-person" + unread; no email: the Admin Manager's Open issues shows it with
// the draft, and the report counts it). Everything the
// assistant sends is logged in that country's email_log (automation 'inbox_ai', dedupe_key
// ai:<inbound message id> — a retried webhook can't answer twice); a hand-over is logged as
// 'inbox_ai_person' (status 'test': nothing was sent). Server only.
import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { relay, phoneParam, inboxMode } from './relayInbox';
import { dbFor } from './db';
import { DEFAULT_COUNTRY } from './adminCountry';
import { phonesBySite } from './inboxData';
import { phoneKey, threadForAi, UNREAD_TAG } from './inboxRules';
import { classifyInbound, inboundItems } from './waClassify';
import { structuralKind } from './waClassifyCore';
import { autoGuards, conversationBlocked, optedOut } from './inboxAutoRules';
import { answerRef } from './aiLinks';
import { loadFactSheet, siteFor } from './aiContext';
import { MODEL, SCHEMA, systemPrompt, buildAsk, AI_SETTINGS, GOALS } from './aiPrompt';
import { portfolioCount, tierOf, needsPerson, portfolioNote, leadNotes, portfolioEmail } from './agencyOffer';
import { sendTeamAlertEmail } from './email';

const ADMIN_URL = 'https://admin.casa-libre.com';
// An agency told us its portfolio size (after CARTERA, or asking about prices): the count goes on
// their lead (potential_leads.notes), and 11+ listings emails the team (omar@ only). Best effort.
async function afterPortfolio(db, cc, phone, n, { name, said, reply, english }) {
  const e164 = `+${phone}`;
  const [lead] = await db.select('potential_leads', `select=id,name,notes&or=(whatsapp.eq.${enc(e164)},phone.eq.${enc(e164)})&limit=1`).catch(() => []);
  if (lead) await db.update('potential_leads', `id=eq.${enc(lead.id)}`, { notes: leadNotes(lead.notes, n), updated_at: new Date().toISOString() }, { returning: 'minimal' }).catch(() => {});
  if (!needsPerson(n)) return;
  const mail = portfolioEmail({ count: n, phone: e164, name: lead?.name || name || '', said, reply, english, link: `${ADMIN_URL}/inbox?phone=${phone}` });
  await sendTeamAlertEmail({ country: cc, ...mail }).catch(() => {});
}

export const AI_AUTOMATION = 'inbox_ai';
export const PERSON_AUTOMATION = 'inbox_ai_person';
export const NEEDS_PERSON_TAG = 'needs-a-person';
export const AI_TAG = 'ai-answered';
export const HOLDING_ES = '¿Podés contarnos un poco más qué pasó? Alguien de nuestro equipo te va a responder en breve.';
const enc = encodeURIComponent;
const digits = (p) => String(p || '').replace(/\D/g, '');
export const autoEnabled = () => String(process.env.INBOX_AI_AUTO || '1') !== '0' && !!process.env.ANTHROPIC_API_KEY;

// the country whose DB and site this chat belongs to: its site tag, else the country that knows
// the number (user / listing / code / campaign), else the default
async function countryFor(conv, phone) {
  const tagged = siteFor(conv, '');
  if (tagged) return tagged;
  const known = (await phonesBySite().catch(() => new Map())).get(phoneKey(phone));
  return known?.[0] || DEFAULT_COUNTRY;
}

// what the assistant already sent in this chat (Relay message ids) + whether this inbound was handled
async function aiLog(db, phone, inboundId) {
  const rows = await db.select('email_log', `select=automation_id,relay_message_id,dedupe_key,error,created_at&automation_id=in.(${AI_AUTOMATION},${PERSON_AUTOMATION})&to_phone=eq.${enc(phone)}&order=created_at.desc&limit=60`).catch(() => []);
  const meta = (r) => { try { return JSON.parse(r.error || '{}') || {}; } catch { return {}; } };
  const covered = new Set();
  for (const r of rows) { const m = meta(r); covered.add(String(m.inbound_id || '')); for (const id of m.covers || []) covered.add(String(id)); }
  const handover = rows.find((r) => r.automation_id === PERSON_AUTOMATION);
  return { ids: new Set(rows.map((r) => r.relay_message_id).filter(Boolean)), covered, handled: rows.some((r) => r.dedupe_key === `ai:${inboundId}`), handedOverAt: handover?.created_at || null };
}

// the assistant's reply (also used by local tests to see what it would write) — the same call the live flow makes
export async function assistantReply(country, thread, facts, conv) { return ask(country, thread, facts, conv); }

async function ask(country, thread, facts, conv) {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 60000, maxRetries: 1 });
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: AI_SETTINGS.max_tokens,
    system: systemPrompt(country),
    output_config: { effort: AI_SETTINGS.effort, format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{ role: 'user', content: buildAsk({ thread, facts, whatsappName: conv?.name || null, windowOpen: !!conv?.window?.open, auto: true }) }],
  });
  const text = (msg.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
  const out = JSON.parse(text);
  return { message: String(out.message || '').trim(), english: String(out.english || ''), note: String(out.note || ''), action: ['send', 'send_and_person', 'person'].includes(out.action) ? out.action : 'person', topic: String(out.topic || '').slice(0, 80), reason: String(out.reason || '').slice(0, 300), holding: String(out.holding || '').trim().slice(0, 400), goal: GOALS.includes(out.goal) ? out.goal : 'none', portfolio: portfolioCount(out.portfolio), usage: msg.usage || null };
}

// d = the webhook's message.inbound data ({ id, from | phone, type, text, button, media, timestamps? })
// → { kind, action, ... } — what was done, for the webhook's reply and the logs
// dryRun (a signed test event with dry: true): decide and return the message, send nothing,
// tag nothing, log nothing.
export async function handleInbound(d, { dryRun = false } = {}) {
  const phone = digits(d?.from || d?.phone);
  const inboundId = String(d?.id || '');
  // what WhatsApp itself says (a button tap, a reaction, a file) — everything with text is sorted by the AI below
  const quick = { kind: structuralKind(d) || 'text' };
  if (!phone || !inboundId) return { kind: quick.kind, action: 'ignored', reason: 'no_phone_or_id' };
  if (quick.kind === 'button') return { kind: quick.kind, action: 'website' };   // the website's webhook answers the buttons
  if (quick.kind === 'emoji') return { kind: quick.kind, action: 'ignored' };
  if (!autoEnabled()) return { kind: quick.kind, action: 'off' };

  const [conv, msgs] = await Promise.all([relay(inboxMode(), `/conversations/${phoneParam(phone)}`), relay(inboxMode(), `/conversations/${phoneParam(phone)}/messages?limit=40`)]);
  if (!msgs.ok) return { kind: quick.kind, action: 'error', reason: 'relay_messages' };
  const list = msgs.data?.data || [];
  const inbound = list.find((m) => m.id === inboundId) || { id: inboundId, timestamps: { created: new Date().toISOString() } };
  const c = conv.ok ? conv.data : null;
  const blocked = conversationBlocked(c);
  if (blocked) return { kind: quick.kind, action: 'ignored', reason: blocked };

  const cc = await countryFor(c, phone);
  const db = dbFor(cc);
  const log = await aiLog(db, `+${phone}`, inboundId);
  if (log.handled) return { kind: quick.kind, action: 'ignored', reason: 'already_handled' };
  const withNew = list.some((m) => m.id === inboundId) ? list : [...list, { ...d, id: inboundId, direction: 'inbound', timestamps: inbound.timestamps }];
  const g = autoGuards({ inbound, messages: withNew, coveredIds: log.covered, aiMessageIds: log.ids });
  // the AI sorts it (robot / thanks / greeting / question …), with how fast it came after our message
  const items = inboundItems(list.some((m) => m.id === inboundId) ? list : [...list, { ...d, id: inboundId, direction: 'inbound', timestamps: inbound.timestamps }], { limit: 1 });
  const sorted = await classifyInbound(db, items.length ? items : [{ id: inboundId, text: d.text, type: d.type, secondsAfterOurs: g.secondsAfterOurs }]);
  const k = sorted.get(inboundId) || { kind: 'text', real: true, by: 'default' };
  const kind = { kind: k.kind, real: k.real, by: k.by, text: String(d?.text ?? d?.button?.text ?? '').trim() };
  if (kind.kind === 'keyword') return { kind: kind.kind, action: 'website', sortedBy: kind.by };
  if (!kind.real) return { kind: kind.kind, action: 'ignored', sortedBy: kind.by };
  if (!g.ok) return { kind: kind.kind, action: 'skipped', reason: g.reason, country: cc };

  const ansRef = answerRef(inboundId);
  const facts = await loadFactSheet(phone, c, cc, { answer: ansRef });
  // they replied BAJA earlier: answer what they ask, nothing more (no offers, no campaign)
  if (optedOut(c)) facts.opted_out_of_marketing = true;
  // the message being answered is always in the thread (Relay may not list it yet when the event arrives)
  const withInbound = list.some((m) => m.id === inboundId) ? list : [...list, { ...d, id: inboundId, direction: 'inbound', type: d.type || 'text', text: kind.text, timestamps: inbound.timestamps }];
  const thread = threadForAi([...withInbound].sort((a, b) => Date.parse(a.timestamps?.created || 0) - Date.parse(b.timestamps?.created || 0)));
  const question = kind.text.slice(0, 500);
  let out;
  try { out = await ask(facts.site.country, thread, facts, c); } catch (e) { return { kind: kind.kind, action: 'error', reason: `claude: ${String(e?.message || e).slice(0, 120)}`, country: cc }; }
  // an agency told us its portfolio size (lib/agencyOffer.js): 11+ listings → a person coordinates
  // the migration, whatever the model chose (the offer is sent, the chat goes to Alerts)
  const portfolio = out.message ? out.portfolio : 0;
  if (needsPerson(portfolio)) {
    out.action = 'send_and_person';
    out.topic = `portfolio: ${portfolio} listings`;
    out.note = [portfolioNote(portfolio), out.note].filter(Boolean).join(' ');
  }
  const base = { automation_id: AI_AUTOMATION, channel: 'whatsapp', to_email: facts.account?.email || '', to_phone: `+${phone}`, subject: out.topic || kind.kind, dedupe_key: `ai:${inboundId}` };
  const meta = { inbound_id: inboundId, covers: g.pending, answer_ref: ansRef, goal: out.goal || 'none', kind: kind.kind, question, english: out.english.slice(0, 600), reason: out.reason, note: out.note, country: cc, situation: facts.situation, ...(portfolio ? { portfolio_listings: portfolio, portfolio_tier: tierOf(portfolio) } : {}) };
  const portfolioFollowUp = () => (portfolio ? afterPortfolio(db, cc, phone, portfolio, { name: c?.name || '', said: question, reply: out.message, english: out.english }).catch(() => {}) : null);

  if (dryRun) return { kind: kind.kind, sortedBy: kind.by, action: `dry:${out.action}`, topic: out.topic, reason: out.reason, note: out.note, country: cc, situation: facts.situation, message: out.message, holding: out.holding, english: out.english, portfolio, usage: out.usage };
  // explained + link sent, and a person decides one part (refund, exception): send it, then flag it
  if (out.action === 'send_and_person' && out.message) {
    const sent = await relay(inboxMode(), '/messages/text', { method: 'POST', headers: { 'Idempotency-Key': `ai:${inboundId}` }, json: { to: `+${phone}`, text: out.message.slice(0, 4096), metadata: { source: PERSON_AUTOMATION, inbound: inboundId, topic: out.topic } } });
    if (!sent.ok) return { kind: kind.kind, action: 'error', reason: `relay_send ${sent.status}: ${sent.data?.error?.message || ''}`.trim(), country: cc };
    await relay(inboxMode(), `/conversations/${phoneParam(phone)}`, { method: 'PATCH', json: { add_tags: [NEEDS_PERSON_TAG, UNREAD_TAG, AI_TAG] } }).catch(() => {});
    await db.insert('email_log', { ...base, automation_id: PERSON_AUTOMATION, status: 'sent', relay_message_id: sent.data?.id || sent.data?.data?.id || null, error: JSON.stringify({ ...meta, action: 'sent_and_person', holding: out.message, draft: '' }) }, { returning: 'minimal' }).catch(() => {});
    await portfolioFollowUp();
    return { kind: kind.kind, action: 'sent_and_person', topic: out.topic, country: cc, message: out.message, ...(portfolio ? { portfolio } : {}) };
  }
  if (out.action === 'send' && out.message) {
    const sent = await relay(inboxMode(), '/messages/text', { method: 'POST', headers: { 'Idempotency-Key': `ai:${inboundId}` }, json: { to: `+${phone}`, text: out.message.slice(0, 4096), metadata: { source: AI_AUTOMATION, inbound: inboundId, topic: out.topic } } });
    if (!sent.ok) return { kind: kind.kind, action: 'error', reason: `relay_send ${sent.status}: ${sent.data?.error?.message || ''}`.trim(), country: cc };
    await db.insert('email_log', { ...base, status: 'sent', relay_message_id: sent.data?.id || sent.data?.data?.id || null, error: JSON.stringify({ ...meta, action: 'sent' }) }, { returning: 'minimal' }).catch(() => {});
    await relay(inboxMode(), `/conversations/${phoneParam(phone)}`, { method: 'PATCH', json: { add_tags: [AI_TAG] } }).catch(() => {});
    await portfolioFollowUp();
    return { kind: kind.kind, action: 'sent', topic: out.topic, country: cc, message: out.message, ...(portfolio ? { portfolio } : {}) };
  }
  // a person: tell them someone will answer, tag + unread, and log it with the draft → the Admin
  // Manager's Open issues shows it until a team member writes
  const holding = out.holding || HOLDING_ES;
  // they were already told "someone will reply" in the last 24 h → don't say it again
  const toldRecently = log.handedOverAt && Date.now() - Date.parse(log.handedOverAt) < 86400000;
  const told = toldRecently ? { ok: false, skipped: true } : await relay(inboxMode(), '/messages/text', { method: 'POST', headers: { 'Idempotency-Key': `hold:${inboundId}` }, json: { to: `+${phone}`, text: holding, metadata: { source: PERSON_AUTOMATION, inbound: inboundId, topic: out.topic } } });
  await relay(inboxMode(), `/conversations/${phoneParam(phone)}`, { method: 'PATCH', json: { add_tags: [NEEDS_PERSON_TAG, UNREAD_TAG] } }).catch(() => {});
  await db.insert('email_log', { ...base, automation_id: PERSON_AUTOMATION, status: told.ok ? 'sent' : 'test', relay_message_id: told.ok ? told.data?.id || told.data?.data?.id || null : null, error: JSON.stringify({ ...meta, action: 'person', holding, draft: out.message.slice(0, 1500) }) }, { returning: 'minimal' }).catch(() => {});
  return { kind: kind.kind, action: 'person', topic: out.topic, country: cc, told: told.ok };
}
