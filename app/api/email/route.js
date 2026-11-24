// /api/email — the info@casa-libre.com mailbox (lib/gmailBridge.js).
// GET  ?view=inbox|important|unread|sent|spam|all&q=&start=&hideJunk=1  → threads (+ AI category)
// POST { action: 'reply', messageId, text, all? }       reply in the same Gmail thread
//      { action: 'send', to, subject, text, cc? }       a new email from info@
//      { action: 'modify', threadId, op }               read / unread / archive / inbox / spam / notspam / trash / star / unstar
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { bridge, bridgeReady } from '@/lib/gmailBridge';
import { viewQuery, categoryFromLabels, VIEWS } from '@/lib/emailTriageCore';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const OPS = new Set(['read', 'unread', 'archive', 'inbox', 'spam', 'notspam', 'trash', 'star', 'unstar']);
const esc = (s) => String(s || '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const toHtml = (text) => `<div style="font-family:Arial,sans-serif;font-size:14px">${esc(text).replace(/\n/g, '<br>')}</div>`;

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!bridgeReady()) return NextResponse.json({ error: 'not_connected' }, { status: 503 });
  const sp = new URL(req.url).searchParams;
  const view = VIEWS[sp.get('view')] ? sp.get('view') : 'inbox';
  const query = viewQuery(view, { search: sp.get('q') || '', hideJunk: sp.get('hideJunk') === '1' });
  const start = Math.max(0, Number(sp.get('start') || 0));
  try {
    const d = await bridge('list', { query, start, max: 40 });
    const threads = (d.threads || []).map((t) => ({ ...t, category: categoryFromLabels(t.labels) }));
    return NextResponse.json({ threads, query, more: threads.length === 40 });
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
      return NextResponse.json({ ok: true, threadId: d.threadId });
    }
    if (b.action === 'send') {
      const to = String(b.to || '').trim(); const subject = String(b.subject || '').trim(); const text = String(b.text || '').trim();
      if (!/\S+@\S+\.\S+/.test(to) || !subject || !text) return NextResponse.json({ error: 'Add a recipient, a subject and a message.' }, { status: 400 });
      const d = await bridge('send', { to, subject, text, html: toHtml(text), cc: String(b.cc || '').trim() || undefined });
      return NextResponse.json({ ok: true, remainingToday: d.remainingToday });
    }
    if (b.action === 'modify') {
      if (!b.threadId || !OPS.has(b.op)) return NextResponse.json({ error: 'bad request' }, { status: 400 });
      const d = await bridge('modify', { threadId: b.threadId, op: b.op });
      return NextResponse.json({ ok: true, thread: { ...d.thread, category: categoryFromLabels(d.thread.labels) } });
    }
    return NextResponse.json({ error: 'unknown action' }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e) }, { status: 502 });
  }
}
