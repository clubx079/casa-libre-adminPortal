import 'server-only';
import { groqFetch } from './aiUsage';
import { bridge } from './gmailBridge';
import { sendTeamAlertEmail } from './email';
import { readForwarding } from './emailForwarding';
import { savePushed, patchThreadRow, threadsMeta } from './emailStore';
import {
  CATEGORIES, ALERTED_LABEL, SYSTEM_PROMPT, buildUserPrompt, parseTriage,
  categoryFromLabels, forwardTargets, parseAddress, nextCategory,
} from './emailTriageCore';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const ADMIN_URL = process.env.ADMIN_PUBLIC_URL || 'https://admin.casa-libre.com';

// Message id → triage result (the summary isn't stored in Gmail, so repeat opens reuse it).
const memo = (globalThis.__clEmailTriageMemo ||= new Map());
const remember = (id, v) => { memo.set(id, v); if (memo.size > 3000) memo.delete(memo.keys().next().value); return v; };

// One email → { category, summary, urgent } or null (Groq off / failed). Never throws.
export async function classifyEmail(msg, { fresh = false } = {}) {
  if (!fresh && msg?.id && memo.has(msg.id)) return memo.get(msg.id);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = process.env.GROQ_MODEL || 'openai/gpt-oss-20b';
  const body = {
    model,
    messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(msg) }],
    temperature: 0,
    max_tokens: 1200,
  };
  if (/gpt-oss|qwen/i.test(model)) body.reasoning_effort = 'low';
  try {
    const res = await groqFetch({ feature: 'email_triage', ref: msg?.id || null })(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = parseTriage(data?.choices?.[0]?.message?.content);
    return out && msg?.id ? remember(msg.id, out) : out;
  } catch {
    return null;
  }
}

// The newest email in the thread that someone else sent (what the category is about).
export const lastInbound = (messages = []) => [...messages].reverse().find((m) => !m.sentByUs) || null;

// Save a conversation's type after sorting its newest incoming email (lib/emailTriageCore.js
// nextCategory): a new type → Gmail label + the saved copy. → the conversation's type now.
async function applyCategory(threadId, labels, triage) {
  const cur = categoryFromLabels(labels || []);
  const next = nextCategory(cur, triage?.category);
  if (next && next !== cur) await bridge('modify', { threadId, op: 'label', label: CATEGORIES[next].label }).catch(() => {});
  if (next) await patchThreadRow(threadId, { category: next, urgent: !!triage?.urgent }).catch(() => {});
  return next;
}

// Sort one thread: classify its last incoming email; the type follows nextCategory().
// → { category (the conversation's type now), summary, urgent } | null
export async function triageThread(threadId, { thread = null, messages = null, fresh = false } = {}) {
  let t = thread; let msgs = messages;
  if (!t || !msgs) { const d = await bridge('thread', { threadId }); t = d.thread; msgs = d.messages; }
  const msg = lastInbound(msgs);
  if (!msg) return null;
  const triage = await classifyEmail(msg, { fresh });
  if (!triage) return null;
  const category = await applyCategory(threadId, t.labels, triage);
  return { ...triage, category };
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Forward one email to the addresses its type goes to (Email → Forwarding settings). Sent from
// the no-reply address; the full text, the AI's one-line summary and a link to answer it from info@.
async function forwardEmail(msg, triage, to) {
  const who = parseAddress(msg.from);
  const cat = CATEGORIES[triage.category].name;
  const subject = `[${cat}${triage.urgent ? ' · reply today' : ''}] ${msg.subject || '(no subject)'} — from ${who.name}`;
  const link = `${ADMIN_URL}/email?thread=${encodeURIComponent(msg.threadId)}`;
  const body = String(msg.text || '').slice(0, 20000);
  const atts = (msg.attachments || []).map((a) => a.name).filter(Boolean);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p style="margin:0 0 6px"><b>${esc(cat)} email to info@casa-libre.com</b>${triage.urgent ? ' <b style="color:#B23A3A">(needs a reply today)</b>' : ''}</p>
<p style="margin:0 0 4px"><b>From:</b> ${esc(who.name)} &lt;${esc(who.email)}&gt;</p>
<p style="margin:0 0 4px"><b>Subject:</b> ${esc(msg.subject)}</p>
<p style="margin:0 0 4px"><b>Date:</b> ${esc(new Date(msg.date).toUTCString())}</p>
${atts.length ? `<p style="margin:0 0 4px"><b>Attachments:</b> ${esc(atts.join(', '))}</p>` : ''}
<p style="margin:10px 0"><a href="${esc(link)}">Open and answer it in the admin</a> (the answer goes out from info@).</p>
<div style="white-space:pre-wrap;background:#FAF7F1;padding:12px;border-radius:8px">${esc(body)}</div>
</div>`;
  const text = `${cat} email to info@casa-libre.com${triage.urgent ? ' (needs a reply today)' : ''}\nFrom: ${who.name} <${who.email}>\nSubject: ${msg.subject}\nOpen: ${link}\n\n${body}`;
  return sendTeamAlertEmail({ country: 'py', to, subject, html, text });
}

// A batch the script pushed. Only fresh incoming emails are worked on (sorted + forwarded per the
// settings); older ones from the first 30-day import are sorted later when the page lists them.
// Emails already handled by this server (the script re-sends the newest email each minute).
const handled = (globalThis.__clEmailHandled ||= new Set());
const markHandled = (id) => { handled.add(id); if (handled.size > 5000) handled.delete(handled.values().next().value); };

export async function handlePushedBatch(messages = [], { now = Date.now(), budgetMs = 40000 } = {}) {
  const started = Date.now();
  const fresh = new Map();   // threadId → newest fresh incoming message
  // every new email is saved first (shows in the admin at once, even before the AI has seen it)
  const unseen = messages.filter((m) => m?.id && !handled.has(m.id));
  if (unseen.length) await savePushed(unseen).catch(() => {});
  for (const m of messages) {
    if (m.sentByUs || handled.has(m.id)) { if (m?.id && m.sentByUs) markHandled(m.id); continue; }
    const t = new Date(m.date).getTime();
    if (!Number.isFinite(t) || now - t > 6 * 3600 * 1000) { markHandled(m.id); continue; }
    const cur = fresh.get(m.threadId);
    if (!cur || new Date(cur.date) < new Date(m.date)) fresh.set(m.threadId, m);
  }
  const done = []; let complete = true;
  if (!fresh.size) return { complete, fresh: 0, done };
  const { rules } = await readForwarding();
  // when each conversation last had an email forwarded (so a new reply in it is forwarded too)
  const meta = await threadsMeta([...fresh.keys()]).catch(() => new Map());
  for (const [threadId, msg] of fresh) {
    if (Date.now() - started > budgetMs) { complete = false; break; }
    try {
      const { thread } = await bridge('thread', { threadId });
      const triage = await classifyEmail(msg);
      // a new email can move the conversation up to Important (never down)
      if (triage) await applyCategory(threadId, thread.labels, triage);
      const to = forwardTargets({ msg, triage, forwardedAt: meta.get(threadId)?.forwarded_at || null, rules, now });
      let forwarded = [];
      if (to.length) {
        const r = await forwardEmail(msg, triage, to);
        if (r?.ok) {
          await bridge('modify', { threadId, op: 'label', label: ALERTED_LABEL });
          await patchThreadRow(threadId, { forwarded_at: new Date().toISOString() }).catch(() => {});
          forwarded = to;
        }
      }
      if (triage) markHandled(msg.id);
      done.push({ threadId, category: triage?.category || null, forwarded: forwarded.length });
    } catch (e) {
      complete = false;
      done.push({ threadId, error: String(e?.message || e) });
    }
  }
  return { complete, fresh: fresh.size, done };
}
