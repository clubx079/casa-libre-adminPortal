// Newest WhatsApp templates first, for Templates → WhatsApp. Relay's API gives no creation
// date: its only date, updated_at, is stamped as each sync walks Meta's list — and Meta lists
// templates newest first, so within a sync the EARLIER stamp = the NEWER template. A template
// whose sync took longer (a video sample) can be stamped late, so templates of one set (same
// name prefix: cl_porfin_*, cl_publica_*…) stay together, the set placed by its newest member.
// If Relay ever sends created_at / submitted_at, that is used instead. Pure — test/waTemplateOrder.test.js.

const t = (v) => { const x = Date.parse(v || ''); return Number.isFinite(x) ? x : Infinity; };
export const setOf = (name) => String(name || '').split('_').slice(0, 2).join('_');

export function newestFirst(list = []) {
  const real = list.some((x) => x.created_at || x.submitted_at);
  if (real) return [...list].sort((a, b) => -(t(a.created_at || a.submitted_at) - t(b.created_at || b.submitted_at)) || a.name.localeCompare(b.name));
  // sync position: earlier stamp = newer
  const rank = new Map();
  for (const x of list) { const s = setOf(x.name); rank.set(s, Math.min(rank.get(s) ?? Infinity, t(x.updated_at))); }
  return [...list].sort((a, b) =>
    (rank.get(setOf(a.name)) - rank.get(setOf(b.name)))
    || (setOf(a.name) === setOf(b.name) ? 0 : setOf(a.name).localeCompare(setOf(b.name)))
    || (t(a.updated_at) - t(b.updated_at))
    || a.name.localeCompare(b.name));
}
