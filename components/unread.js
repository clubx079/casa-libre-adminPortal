'use client';
// Client side of the per-admin unread counters (lib/unread.js, /api/unread).
import { useEffect, useState } from 'react';

const EVENT = 'cl:unread-changed';

// Sidebar: { reports, feedbacks, inbox } for the signed-in admin. Refreshes on mount, when `path`
// changes, every minute, and right after a page marks itself seen.
export function useUnreadCounts(path) {
  const [counts, setCounts] = useState({});
  useEffect(() => {
    let alive = true;
    const load = () => fetch('/api/unread', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (alive && !j.error) setCounts(j); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    window.addEventListener(EVENT, load);
    return () => { alive = false; clearInterval(t); window.removeEventListener(EVENT, load); };
  }, [path]);
  return counts;
}

// A page: mark it seen for this admin once on open; → `since` (ISO) — rows created after
// it were new to this admin (tag them "New"). null until known / before migration 008.
export function useMarkSeen(page) {
  const [since, setSince] = useState(null);
  useEffect(() => {
    fetch('/api/unread', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) })
      .then((r) => r.json())
      .then((j) => { if (j.since) setSince(j.since); window.dispatchEvent(new Event(EVENT)); })
      .catch(() => {});
  }, [page]);
  return since;
}

// Something was read elsewhere (e.g. a WhatsApp chat opened in Inbox) → badges reload now.
export const refreshUnread = () => window.dispatchEvent(new Event(EVENT));

export const isNewSince = (createdAt, since) => !!since && Date.parse(createdAt) > Date.parse(since);
