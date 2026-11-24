import 'server-only';
// Email (info@) — bring Gmail into the saved copy (lib/emailStore.js) in the background.
//  syncFolder(view): the folder's newest conversations from Gmail → saved (state, labels), the
//    ones with no saved emails yet are fetched whole, and a few unsorted ones get their AI type.
//  syncThread(id): one conversation, whole.
// Each call to the Gmail script costs ~2 s, so the page never waits for these: it shows the saved
// copy at once and reloads it when a sync finishes.
import { bridge } from './gmailBridge';
import { labelQuery } from './emailTriageCore';
import { saveThreads, saveThread, missingMessages, unsortedIds, ready } from './emailStore';
import { triageThread } from './emailTriage';

const G = (globalThis.__clEmailSync ||= { inflight: new Map(), noInbound: new Set() });

// The Gmail search behind each folder, and what a hit there tells us about the thread.
const GMAIL = {
  inbox: { q: 'in:inbox', extra: { in_spam: false, in_trash: false } },
  unread: { q: 'in:inbox is:unread', extra: { in_spam: false, in_trash: false } },
  important: { q: labelQuery('important'), extra: { in_spam: false, in_trash: false } },
  marketing: { q: labelQuery('marketing'), extra: { in_spam: false, in_trash: false } },
  other: { q: labelQuery('other'), extra: { in_spam: false, in_trash: false } },
  sent: { q: 'in:sent', extra: { has_sent: true, in_spam: false, in_trash: false } },
  spam: { q: 'in:spam', extra: { in_spam: true, in_inbox: false } },
  trash: { q: 'in:trash', extra: { in_trash: true } },
  all: { q: '-in:drafts', extra: { in_spam: false, in_trash: false } },
};

function once(key, fn) {
  if (G.inflight.has(key)) return G.inflight.get(key);
  const p = fn().finally(() => G.inflight.delete(key));
  G.inflight.set(key, p);
  return p;
}

export async function syncThread(id) {
  return once(`t:${id}`, async () => {
    const d = await bridge('thread', { threadId: id });
    await saveThread(d.thread, d.messages);
    return d;
  });
}

// Give the newest unsorted conversations their AI type (a few per call; the rest next time).
export async function sortSome(limit = 6) {
  const ids = await unsortedIds(limit, G.noInbound);
  for (const id of ids) {
    const d = await syncThread(id).catch(() => null);
    if (!d) continue;
    const t = await triageThread(id, { thread: d.thread, messages: d.messages }).catch(() => null);
    if (!t && !d.messages.some((m) => !m.sentByUs)) G.noInbound.add(id);   // only our own emails: nothing to sort
  }
  return ids.length;
}

// Sort every saved conversation again with today's rules (the newest incoming email of each; a
// conversation only moves up to Important, never down). → { checked, moved: [{ id, from, to }] }
export async function resortAll({ limit = 200 } = {}) {
  const { listFromStore } = await import('./emailStore');
  const { threads } = await listFromStore('all', { size: limit });
  const moved = []; const seen = [];
  for (const t of threads) {
    if (t.category === 'important') continue;
    const d = await syncThread(t.id).catch(() => null);
    if (!d) continue;
    const r = await triageThread(t.id, { thread: d.thread, messages: d.messages, fresh: true }).catch(() => null);
    if (r?.category && r.category !== t.category) moved.push({ id: t.id, subject: t.subject, from: t.category, to: r.category });
    else seen.push({ subject: t.subject, kept: t.category, newest: r ? r.summary : null });
  }
  return { checked: threads.length, moved, seen };
}

// → { synced: n } — the folder's first page from Gmail, saved.
export async function syncFolder(view = 'inbox', { q = '', pages = 1 } = {}) {
  if (!ready()) return { synced: 0, ready: false };
  const g = GMAIL[view] || GMAIL.inbox;
  const query = q ? `${g.q} ${q}` : g.q;
  return once(`f:${query}:${pages}`, async () => {
    let all = [];
    for (let p = 0; p < pages; p++) {
      const d = await bridge('list', { query, start: p * 50, max: 50 });
      all = all.concat(d.threads || []);
      if ((d.threads || []).length < 50) break;
    }
    await saveThreads(all, g.extra);
    // conversations with no saved emails yet → fetch them whole (newest first, 10 per call)
    const need = await missingMessages(all.map((t) => t.id));
    for (const id of need.slice(0, pages > 1 ? 200 : 10)) await syncThread(id).catch(() => {});
    await sortSome(pages > 1 ? 40 : 6).catch(() => {});
    return { synced: all.length, fetched: Math.min(need.length, pages > 1 ? 200 : 10) };
  });
}
