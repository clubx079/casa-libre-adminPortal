import 'server-only';
import { groqFetch } from './aiUsage';
import { bridge } from './gmailBridge';
import { sendTeamAlertEmail, ADMIN_TEST_EMAIL } from './email';
import {
  CATEGORIES, ALERTED_LABEL, SYSTEM_PROMPT, buildUserPrompt, parseTriage,
  categoryFromLabels, shouldAlert, parseAddress,
} from './emailTriageCore';

const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const ADMIN_URL = process.env.ADMIN_PUBLIC_URL || 'https://admin.casa-libre.com';

// Message id → triage result (the summary isn't stored in Gmail, so repeat opens reuse it).
const memo = new Map();
const remember = (id, v) => { memo.set(id, v); if (memo.size > 3000) memo.delete(memo.keys().next().value); return v; };

// One email → { category, summary, urgent } or null (Groq off / failed). Never throws.
export async function classifyEmail(msg) {
  if (msg?.id && memo.has(msg.id)) return memo.get(msg.id);
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

// Sort one thread: classify its last incoming email and save the category as a Gmail label.
// → { category, summary, urgent } | null. Already-sorted threads keep their label.
export async function triageThread(threadId, { thread = null, messages = null } = {}) {
  let t = thread; let msgs = messages;
  if (!t || !msgs) { const d = await bridge('thread', { threadId }); t = d.thread; msgs = d.messages; }
  const msg = lastInbound(msgs);
  if (!msg) return null;
  const triage = await classifyEmail(msg);
  if (triage && !categoryFromLabels(t.labels)) {
    await bridge('modify', { threadId, op: 'label', label: CATEGORIES[triage.category].label }).catch(() => {});
  }
  return triage;
}

const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Who gets the "important email" alert. Omar only until EMAIL_ALERT_TO lists more people.
export const alertRecipients = () => (process.env.EMAIL_ALERT_TO || ADMIN_TEST_EMAIL)
  .split(',').map((s) => s.trim()).filter(Boolean);

async function sendAlert(msg, triage) {
  const who = parseAddress(msg.from);
  const cat = CATEGORIES[triage.category].name;
  const subject = `${triage.urgent ? 'URGENT · ' : ''}${cat} email to info@: ${msg.subject || '(no subject)'}`;
  const link = `${ADMIN_URL}/email?thread=${encodeURIComponent(msg.threadId)}`;
  const preview = String(msg.text || '').slice(0, 1200);
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#111">
<p><b>${esc(cat)}${triage.urgent ? ' (needs a reply today)' : ''}</b> from ${esc(who.name)} &lt;${esc(who.email)}&gt;</p>
<p><b>Subject:</b> ${esc(msg.subject)}</p>
<p><b>In short:</b> ${esc(triage.summary)}</p>
<pre style="white-space:pre-wrap;font-family:Arial,sans-serif;background:#FAF7F1;padding:12px;border-radius:8px">${esc(preview)}</pre>
<p><a href="${esc(link)}">Open it in the admin</a> or answer it in Gmail (info@casa-libre.com).</p>
</div>`;
  const text = `${cat}${triage.urgent ? ' (needs a reply today)' : ''} from ${who.name} <${who.email}>\nSubject: ${msg.subject}\nIn short: ${triage.summary}\n\n${preview}`;
  return sendTeamAlertEmail({ country: 'py', to: alertRecipients(), subject, html, text });
}

// A batch the script pushed. Only fresh incoming emails are worked on (sorted + maybe an
// alert); older ones from the first 30-day import are sorted later when the page lists them.
export async function handlePushedBatch(messages = [], { now = Date.now(), budgetMs = 40000 } = {}) {
  const started = Date.now();
  const fresh = new Map();   // threadId → newest fresh incoming message
  for (const m of messages) {
    if (m.sentByUs) continue;
    const t = new Date(m.date).getTime();
    if (!Number.isFinite(t) || now - t > 6 * 3600 * 1000) continue;
    const cur = fresh.get(m.threadId);
    if (!cur || new Date(cur.date) < new Date(m.date)) fresh.set(m.threadId, m);
  }
  const done = []; let complete = true;
  for (const [threadId, msg] of fresh) {
    if (Date.now() - started > budgetMs) { complete = false; break; }
    try {
      const { thread } = await bridge('thread', { threadId });
      const triage = await classifyEmail(msg);
      if (triage && !categoryFromLabels(thread.labels)) {
        await bridge('modify', { threadId, op: 'label', label: CATEGORIES[triage.category].label });
      }
      let alerted = false;
      if (shouldAlert({ msg, triage, labels: thread.labels, now })) {
        const r = await sendAlert(msg, triage);
        if (r?.ok) { await bridge('modify', { threadId, op: 'label', label: ALERTED_LABEL }); alerted = true; }
      }
      done.push({ threadId, category: triage?.category || null, alerted });
    } catch (e) {
      complete = false;
      done.push({ threadId, error: String(e?.message || e) });
    }
  }
  return { complete, fresh: fresh.size, done };
}
