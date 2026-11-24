import 'server-only';
// Email (info@) — the saved copy of the mailbox in the CONTROL DB (migrations/016_email_mailbox.sql):
// email_threads (one row per conversation, with the AI's type) + email_messages (every email).
// The page reads from here at once; Gmail (lib/gmailBridge.js) is fetched in the background and
// written back here. Until the migration is run, ready() is false and the page reads Gmail directly.
import { categoryFromLabels } from './emailTriageCore';

const URL_ = () => String(process.env.CONTROL_DB_URL || '').replace(/\/$/, '');
const KEY = () => process.env.CONTROL_DB_KEY || '';
const H = (extra = {}) => ({ apikey: KEY(), Authorization: `Bearer ${KEY()}`, 'Content-Type': 'application/json', ...extra });
const G = (globalThis.__clEmailStore ||= { missingUntil: 0 });

export const ready = () => !!(URL_() && KEY()) && Date.now() > G.missingUntil;

async function req(path, init = {}) {
  const res = await fetch(`${URL_()}/rest/v1/${path}`, { cache: 'no-store', ...init, headers: H(init.headers), signal: AbortSignal.timeout(10000) });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 404 || /PGRST205|42P01|does not exist/.test(body)) G.missingUntil = Date.now() + 5 * 60_000;
    throw new Error(`email store ${res.status}: ${body.slice(0, 200)}`);
  }
  return res;
}

const enc = encodeURIComponent;
const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

// ── folders → filters ──
export function folderFilter(view) {
  switch (view) {
    case 'important': return 'category=eq.important&in_trash=eq.false&in_spam=eq.false';
    case 'marketing': return 'category=eq.marketing&in_trash=eq.false&in_spam=eq.false';
    case 'other': return 'category=eq.other&in_trash=eq.false&in_spam=eq.false';
    case 'unread': return 'unread=eq.true&in_inbox=eq.true';
    case 'sent': return 'has_sent=eq.true&in_trash=eq.false';
    case 'spam': return 'or=(in_spam.eq.true,category.eq.spam)&in_trash=eq.false';
    case 'trash': return 'in_trash=eq.true';
    case 'all': return 'in_trash=eq.false&in_spam=eq.false';
    case 'inbox':
    default: return 'in_inbox=eq.true&in_trash=eq.false&in_spam=eq.false';
  }
}
const searchFilter = (q) => {
  const s = String(q || '').trim().replace(/[(),*%]/g, ' ').trim();
  if (!s) return '';
  const p = enc(`%${s}%`);   // this PostgREST wants % (a * pattern matches nothing)
  return `&or=(subject.ilike.${p},last_from.ilike.${p},snippet.ilike.${p})`;
};

const THREAD_COLS = 'id,subject,snippet,last_from,last_date,message_count,unread,in_inbox,in_spam,in_trash,has_sent,starred,has_attachments,labels,category,urgent';
export const rowToThread = (r) => ({
  id: r.id, subject: r.subject || '', snippet: r.snippet || '', lastFrom: r.last_from || '', lastDate: r.last_date,
  count: r.message_count || 1, unread: !!r.unread, inInbox: !!r.in_inbox, inSpam: !!r.in_spam, inTrash: !!r.in_trash,
  starred: !!r.starred, hasAttachments: !!r.has_attachments, labels: r.labels || [], category: r.category || null, urgent: !!r.urgent,
});

// → { threads, total }
export async function listFromStore(view, { q = '', page = 0, size = 50, hideJunk = false } = {}) {
  let f = folderFilter(view) + searchFilter(q);
  if (hideJunk && (view === 'inbox' || view === 'unread')) f += '&or=(category.is.null,category.not.in.(marketing,spam))';
  const res = await req(`email_threads?select=${THREAD_COLS}&${f}&order=last_date.desc.nullslast&limit=${size}&offset=${page * size}`, { headers: { Prefer: 'count=exact' } });
  const rows = await res.json();
  const total = Number((res.headers.get('content-range') || '').split('/')[1]) || rows.length;
  return { threads: rows.map(rowToThread), total };
}

// Unread counts for the folder list (Gmail-style numbers next to Inbox, Important, …)
export async function unreadCounts() {
  const views = ['inbox', 'important', 'marketing', 'other', 'spam'];
  const out = {};
  await Promise.all(views.map(async (v) => {
    const res = await req(`email_threads?select=id&${folderFilter(v)}&unread=eq.true&limit=1`, { headers: { Prefer: 'count=exact' } }).catch(() => null);
    out[v] = res ? Number((res.headers.get('content-range') || '').split('/')[1]) || 0 : 0;
  }));
  return out;
}

export async function threadFromStore(id) {
  const [rows, msgs] = await Promise.all([
    req(`email_threads?select=${THREAD_COLS}&id=eq.${enc(id)}&limit=1`).then((r) => r.json()),
    req(`email_messages?select=*&thread_id=eq.${enc(id)}&order=sent_at.asc`).then((r) => r.json()),
  ]);
  if (!rows[0] || !msgs.length) return null;
  return {
    thread: rowToThread(rows[0]),
    messages: msgs.map((m) => ({
      id: m.id, threadId: m.thread_id, date: m.sent_at, from: m.from_addr || '', to: m.to_addr || '', cc: m.cc || '', replyTo: m.reply_to || '',
      subject: m.subject || '', text: m.body_text || '', html: m.body_html || '', attachments: m.attachments || [], sentByUs: !!m.sent_by_us, unread: !!m.unread,
    })),
  };
}

export async function threadsMeta(ids) {
  if (!ids.length) return new Map();
  const rows = await req(`email_threads?select=id,category,urgent,forwarded_at,labels&id=${inList(ids)}`).then((r) => r.json());
  return new Map(rows.map((r) => [r.id, r]));
}

async function upsert(table, rows) {
  if (!rows.length) return;
  for (let i = 0; i < rows.length; i += 100) {
    await req(`${table}?on_conflict=id`, { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(rows.slice(i, i + 100)) });
  }
}

// A Gmail thread summary (bridge 'list' / 'thread' / 'modify') → its row. category only when
// known (from the AI labels), so a saved type is never wiped.
export function threadRow(t, extra = {}) {
  const row = {
    id: t.id, subject: t.subject ?? null, snippet: t.snippet ?? null, last_from: t.lastFrom ?? null, last_date: t.lastDate ?? null,
    message_count: t.count ?? 1, unread: !!t.unread, in_inbox: !!t.inInbox, starred: !!t.starred, labels: t.labels || [],
    synced_at: new Date().toISOString(), ...extra,
  };
  const cat = categoryFromLabels(t.labels || []);
  if (cat) row.category = cat;
  return row;
}

export async function saveThreads(list, extra = {}) {
  if (!ready() || !list.length) return;
  // PostgREST bulk upsert needs the same keys on every row: rows with and without a category go apart
  const withCat = list.map((t) => threadRow(t, extra));
  await upsert('email_threads', withCat.filter((r) => 'category' in r));
  await upsert('email_threads', withCat.filter((r) => !('category' in r)));
}

// A whole thread (bridge 'thread') → thread row + every message row.
export async function saveThread(thread, messages, extra = {}) {
  if (!ready()) return;
  const row = threadRow(thread, {
    has_sent: messages.some((m) => m.sentByUs),
    has_attachments: messages.some((m) => (m.attachments || []).length > 0),
    in_trash: messages.length > 0 && messages.every((m) => m.inTrash),
    ...extra,
  });
  await upsert('email_threads', [row]);
  await upsert('email_messages', messages.map((m) => ({
    id: m.id, thread_id: thread.id, sent_at: m.date, from_addr: m.from, to_addr: m.to, cc: m.cc, reply_to: m.replyTo,
    subject: m.subject, body_text: m.text ?? null, body_html: m.html ?? null, attachments: m.attachments || [],
    sent_by_us: !!m.sentByUs, unread: !!m.unread,
  })));
}

// Pushed emails (the script's batch): their threads + messages, before the AI has seen them.
export async function savePushed(messages) {
  if (!ready() || !messages.length) return;
  const byThread = new Map();
  for (const m of messages) { if (!byThread.has(m.threadId)) byThread.set(m.threadId, []); byThread.get(m.threadId).push(m); }
  const have = await req(`email_threads?select=id,message_count,last_date&id=${inList([...byThread.keys()])}`).then((r) => r.json()).catch(() => []);
  const known = new Map(have.map((r) => [r.id, r]));
  const rows = [];
  for (const [id, ms] of byThread) {
    ms.sort((a, b) => new Date(a.date) - new Date(b.date));
    const last = ms[ms.length - 1];
    const k = known.get(id);
    rows.push({
      id, subject: ms[0].subject, snippet: String(last.text || '').replace(/\s+/g, ' ').slice(0, 200), last_from: last.from,
      last_date: k?.last_date && new Date(k.last_date) > new Date(last.date) ? k.last_date : last.date,
      message_count: Math.max(k?.message_count || 0, ms.length), unread: ms.some((m) => m.unread), in_inbox: ms.some((m) => m.inInbox),
      has_sent: ms.some((m) => m.sentByUs), has_attachments: ms.some((m) => (m.attachments || []).length > 0), synced_at: new Date().toISOString(),
    });
  }
  await upsert('email_threads', rows);
  await upsert('email_messages', messages.map((m) => ({
    id: m.id, thread_id: m.threadId, sent_at: m.date, from_addr: m.from, to_addr: m.to, cc: m.cc, reply_to: m.replyTo,
    subject: m.subject, body_text: m.text ?? null, body_html: m.html ?? null, attachments: m.attachments || [],
    sent_by_us: !!m.sentByUs, unread: !!m.unread,
  })));
}

export async function patchThreadRow(id, patch) {
  if (!ready()) return;
  await req(`email_threads?id=eq.${enc(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ...patch, synced_at: new Date().toISOString() }) });
}

// Threads that have no messages saved yet (need a full fetch) among these ids.
export async function missingMessages(ids) {
  if (!ready() || !ids.length) return ids;
  const rows = await req(`email_messages?select=thread_id&thread_id=${inList(ids)}`).then((r) => r.json());
  const have = new Set(rows.map((r) => r.thread_id));
  return ids.filter((id) => !have.has(id));
}

export async function unsortedIds(limit = 8, skip = new Set()) {
  if (!ready()) return [];
  const rows = await req(`email_threads?select=id&category=is.null&in_trash=eq.false&order=last_date.desc&limit=${limit + skip.size}`).then((r) => r.json()).catch(() => []);
  return rows.map((r) => r.id).filter((id) => !skip.has(id)).slice(0, limit);
}
