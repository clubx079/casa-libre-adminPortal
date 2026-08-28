// Pure decision for the `stopWhenKnown` early-stop (Task 9): did a page
// contain items, AND did every one of them turn out to be already-known +
// unchanged (zero inserts/updates/quarantines/duplicates/errors)?
//
// Lives in its own zero-dependency module (rather than inline in
// lib/scrape.js) specifically so it can be unit-tested directly: lib/scrape.js
// starts with `import 'server-only'`, a Next.js server-boundary guard that
// only resolves inside Next's webpack build, not under plain Vitest module
// resolution — importing lib/scrape.js from a test throws
// "Cannot find package 'server-only'". Extracting the pure logic here avoids
// mocking that (or the rest of the DB-backed runJob pipeline) just to test a
// boolean.
export function pageIsAllKnown(itemCount, activityCount) {
  return itemCount > 0 && activityCount === 0;
}
