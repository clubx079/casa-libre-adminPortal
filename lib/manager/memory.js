// Admin Manager — what it REMEMBERS between runs, so every report is smarter than the last:
//   memory   — standing notes from the admins ("Tahir already runs a rentals campaign",
//              "Daniel's case is closed"), plus lessons the manager suggested and an admin
//              accepted. Read by every run. Stored per country DB as the `automations` row
//              'manager_memory' (notes in free_tiers[0]; no table of its own, no DB change).
//   tracker  — every action the manager raised, carried from report to report until it is
//              fixed or an admin marks it done: first seen, how many reports raised it, its
//              status each time. Saved inside each report (report.tracker).
//   notes    — the admins' notes / 👍👎 / "done" on the last reports' items.
// Pure, except readMemory / writeMemory. test/managerMemory.test.js.

export const MEMORY_ID = 'manager_memory';
export const MAX_NOTES = 60;
export const HISTORY_REPORTS = 4;      // how many earlier reports a run reads
export const DROP_AFTER = 4;           // an action no report mentioned for this many runs → stale

const clean = (v, n = 500) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

// ── memory (standing notes) ────────────────────────────────────────────────

export function notesFromRow(row) {
  const s = row && Array.isArray(row.free_tiers) && row.free_tiers[0] && typeof row.free_tiers[0] === 'object' ? row.free_tiers[0] : {};
  return (Array.isArray(s.notes) ? s.notes : []).filter((n) => n && n.text);
}

export async function readMemory(db) {
  const rows = await db.select('automations', `select=id,free_tiers&id=eq.${MEMORY_ID}&limit=1`).catch(() => []);
  return notesFromRow(rows[0]);
}

export async function writeMemory(db, notes) {
  const free_tiers = [{ notes: notes.slice(-MAX_NOTES) }];
  const rows = await db.select('automations', `select=id&id=eq.${MEMORY_ID}&limit=1`);
  const patch = { enabled: false, free_tiers, updated_at: new Date().toISOString() };
  if (rows[0]) await db.update('automations', `id=eq.${MEMORY_ID}`, patch, { returning: 'minimal' });
  else await db.insert('automations', [{ id: MEMORY_ID, wait_days: 0, ...patch }], { returning: 'minimal' });
  return free_tiers[0].notes;
}

// → { ok, notes, error }
export function addNote(notes, { text, by = null, source = 'admin', id }) {
  const t = clean(text);
  if (t.length < 3) return { ok: false, error: 'Write the note first.' };
  if (notes.some((n) => n.text.toLowerCase() === t.toLowerCase())) return { ok: false, error: 'That note is already saved.' };
  return { ok: true, notes: [...notes, { id, text: t, by, source, at: new Date().toISOString() }].slice(-MAX_NOTES) };
}

export const removeNote = (notes, id) => notes.filter((n) => n.id !== id);

// ── the loop: what earlier reports raised ─────────────────────────────────

// A short stable key from a title ("Fix the no-listing email button" → "fix-no-listing-email-button").
export function slug(text) {
  const stop = new Set(['the', 'a', 'an', 'to', 'of', 'and', 'for', 'in', 'on', 'with', 'el', 'la', 'de']);
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter((w) => w && !stop.has(w)).slice(0, 6).join('-') || 'item';
}

// The tracker a report carries. Old reports (before the tracker) → their recommendations.
export function trackerOf(row) {
  if (!row) return [];
  if (Array.isArray(row.report?.tracker)) return row.report.tracker;
  return (row.report?.recommendations || []).map((r) => ({
    key: slug(r.title), title: r.title, owner: r.owner, first_seen: row.created_at, times: 1, status: 'new', last_seen: row.created_at, quiet: 0,
  }));
}

// The admins' input on a report: notes / votes on items and the "done" ticks.
export function adminInput(row) {
  const fb = Object.values(row?.feedback || {}).filter((f) => f && (f.vote || f.note || f.done));
  return fb.map((f) => ({ item: f.item, vote: f.vote || null, note: f.note || null, done: !!f.done, by: f.by || null, at: f.at || null }));
}

// What the next run is told about earlier reports. recent: newest first.
export function historyForRun(recent = []) {
  const last = recent[0] || null;
  const doneKeys = new Set();
  for (const r of recent) for (const f of adminInput(r)) if (f.done && String(f.item).startsWith('action:')) doneKeys.add(String(f.item).slice(7));
  const open = trackerOf(last)
    .filter((t) => !['fixed', 'done', 'stale'].includes(t.status))
    .map((t) => ({ key: t.key, title: t.title, owner: t.owner, first_seen: t.first_seen, times_raised: t.times, last_status: t.status, marked_done_by_admin: doneKeys.has(t.key) }));
  return {
    openActions: open,
    adminNotes: recent.flatMap((r) => adminInput(r).filter((f) => f.note || f.vote).map((f) => ({ report_date: String(r.created_at || '').slice(0, 10), ...f }))).slice(0, 40),
    earlierHeadlines: recent.map((r) => ({ date: String(r.created_at || '').slice(0, 10), headline: r.report?.headline || null })),
  };
}

// This run's actions + follow-up checks + the previous tracker → the new tracker.
// doneKeys: actions an admin marked done since. now: ISO time of this run.
export function nextTracker({ previous = [], actions = [], checks = [], doneKeys = new Set(), now }) {
  const byKey = new Map(previous.map((t) => [t.key, { ...t }]));
  const checkBy = new Map(checks.map((c) => [c.key, c]));
  const out = [];
  const seen = new Set();
  for (const a of actions) {
    const old = byKey.get(a.key);
    const status = old ? (a.status === 'worse' ? 'worse' : 'still_open') : 'new';
    out.push({ key: a.key, title: a.title, owner: a.owner, first_seen: old?.first_seen || now, last_seen: now, times: (old?.times || 0) + 1, status, quiet: 0 });
    seen.add(a.key);
  }
  for (const t of previous) {
    if (seen.has(t.key) || ['fixed', 'done', 'stale'].includes(t.status)) continue;
    const c = checkBy.get(t.key);
    // not raised again: what the check says, else just 'open' (this run did not look at it)
    let status = t.status === 'new' ? 'open' : t.status;
    if (doneKeys.has(t.key)) status = c?.status === 'worse' || c?.status === 'still_open' ? 'reopened' : 'done';
    else if (c) status = ['fixed', 'improving', 'worse', 'still_open', 'unclear'].includes(c.status) ? c.status : status;
    const quiet = c ? 0 : (t.quiet || 0) + 1;
    if (quiet >= DROP_AFTER) status = 'stale';
    out.push({ ...t, status, quiet, last_check: c ? { status: c.status, evidence: c.evidence, at: now } : t.last_check || null });
  }
  return out;
}
