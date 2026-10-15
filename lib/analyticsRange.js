// Date ranges on the Analytics page. One master range at the top drives every
// section; a section can still pick its own range to compare, and that choice
// only lasts until the master changes again.

// Windows the PostHog routes accept (they whitelist exactly these).
export const RANGES = [
  { v: 7, l: '7 days' },
  { v: 30, l: '30 days' },
  { v: 90, l: '3 months' },
  { v: 180, l: '6 months' },
  { v: 365, l: '12 months' },
];
export const DEFAULT_DAYS = 7;

// "7 days", "3 months" … (falls back to "N days" for anything off the list).
export const rangeName = (d, options = RANGES) => options.find((r) => r.v === d)?.l || `${d} days`;
// "last 7 days" / "last 3 months" …
export const rangeLabel = (d, options = RANGES) => `last ${rangeName(d, options)}`;

// A section's own pick, remembered together with the master it was made under:
// { master, days } or null. It counts only while the master is unchanged, so
// moving the master resets every section back to it.
export const sectionDays = (master, override) =>
  (override && override.master === master ? override.days : master);

// What to store when a section picks `days` while the master is `master`.
// Picking the master's own value clears the override.
export const pickSection = (master, days) => (days === master ? null : { master, days });

// Options for a section's picker, always including the value it is showing.
export const optionsWith = (options, d) =>
  (options.some((o) => o.v === d) ? options : [...options, { v: d, l: rangeName(d) }].sort((a, b) => a.v - b.v));
