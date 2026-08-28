// Unit test for the `stopWhenKnown` early-stop decision (Task 9). The full
// `runJob` is DB-backed end-to-end (properties/quarantine/images/AI classify)
// and its module (lib/scrape.js) opens with `import 'server-only'`, which
// only resolves inside Next's webpack build — not under plain Vitest. Rather
// than mock either the pipeline or the `server-only` guard, the "was this
// page entirely already-known + unchanged?" decision lives in its own
// zero-dependency module (lib/scrapePageActivity.js, re-exported from
// lib/scrape.js) and is tested directly here. Full integration behavior is
// covered by the live cron smoke test (Task 8).
import { describe, it, expect } from 'vitest';
import { pageIsAllKnown } from '../lib/scrapePageActivity.js';

describe('pageIsAllKnown', () => {
  it('is true when a non-empty page produced zero activity (all plain skips)', () => {
    expect(pageIsAllKnown(50, 0)).toBe(true);
  });

  it('is false when the page had any activity (insert/update/quarantine/duplicate/error)', () => {
    expect(pageIsAllKnown(50, 1)).toBe(false);
    expect(pageIsAllKnown(50, 50)).toBe(false);
  });

  it('is false for an empty page (nothing to conclude "known" from)', () => {
    expect(pageIsAllKnown(0, 0)).toBe(false);
  });
});
