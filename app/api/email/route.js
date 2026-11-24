// /api/email — the info@casa-libre.com mailbox.
// GET  ?view=inbox|important|marketing|other|unread|sent|spam|trash|all&q=&page=&hideJunk=1
//      → { threads, total, counts } from the saved copy (lib/emailStore.js) at once. Before the
//      migration is run it reads Gmail directly (slower).
// POST { action: 'reply', messageId, text, all? }   reply in the same Gmail thread
//      { action: 'send', to, subject, text, cc? }   a new email (or a forward) from info@
//      { action: 'modify', threadId, op }           read / unread / archive / inbox / spam / notspam / trash / star / unstar
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridge, bridgeReady } from '@/lib/gmailBridge';
import { viewQuery, categoryFromLabels, VIEWS } from '@/lib/emailTriageCore';
import { ready, listFromStore, unreadCounts, saveThreads } from '@/lib/emailStore';
import { syncThread, syncFolder } from '@/lib/emailSync';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS = new Set(['read', 'unread', 'archive', 'inbox', 'spam', 'notspam', 'trash', 'star', 'unstar']);
const FOLDERS = new Set([...Object.keys(VIEWS), 'trash']);
const OP_EXTRA = {
  spam: { in_spam: true, in_inbox: false },
  notspam: { in_spam: false, in_inbox: true },
  trash: { in_trash: true, in_inbox: false },
  inbox: { in_trash: false, in_spam: false },
};
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toHtml = (text) => `<div style="font-family:Arial,sans-serif;font-size:14px">${esc(text).replace(/\n/g, '<br>')}</div>`;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const view = FOLDERS.has(sp.get('view')) ? sp.get('view') : 'inbox';
  const q = sp.get('q') || '';
  const page = Math.max(0, Number(sp.get('page') || 0));
  const hideJunk = sp.get('hideJunk') === '1';
  if (ready()) {
    try {
      const [list, counts] = await Promise.all([listFromStore(view, { q, page, hideJunk }), unreadCounts().catch(() => ({}))]);
      return NextResponse.json({ ...list, counts, saved: true });
    } catch { /* table missing → read Gmail directly below */ }
  }
  try {
    const query = view === 'trash' ? 'in:trash' : viewQuery(view, { search: q, hideJunk });
    const d = await bridge('list', { query, start: page * 50, max: 50 });
    const threads = (d.threads || []).map((t) => ({ ...t, category: categoryFromLabels(t.labels) }));
    return NextResponse.json({ threads, total: page * 50 + threads.length + (threads.length === 50 ? 1 : 0), counts: {}, saved: false });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  try {
    if (b.action === 'reply') {
      const text = String(b.text || '').trim();
      if (!b.messageId || !text) return NextResponse.json({ error: 'Write a reply first.' }, { status: 400 });
      const d = await bridge('reply', { messageId: b.messageId, text, html: toHtml(text), all: !!b.all });
      await syncThread(d.threadId).catch(() => {});
      return NextResponse.json({ ok: true, threadId: d.threadId });
    }
    if (b.action === 'send') {
      const to = String(b.to || '').trim();
      const subject = String(b.subject || '').trim();
      const text = String(b.text || '').trim();
      if (!/\S+@\S+\.\S+/.test(to) || !subject || !text) return NextResponse.json({ error: 'Add a recipient, a subject and a message.' }, { status: 400 });
      const d = await bridge('send', { to, subject, text, html: toHtml(text), cc: String(b.cc || '').trim() || undefined });
      syncFolder('sent').catch(() => {});
      return NextResponse.json({ ok: true, remainingToday: d.remainingToday });
    }
    if (b.action === 'modify') {
      if (!b.threadId || !OPS.has(b.op)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
      const d = await bridge('modify', { threadId: b.threadId, op: b.op });
      await saveThreads([d.thread], OP_EXTRA[b.op] || {}).catch(() => {});
      return NextResponse.json({ ok: true, thread: { ...d.thread, category: categoryFromLabels(d.thread.labels) } });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
