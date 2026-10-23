// Delisting: scraped listings the agency took down leave our site.
// Daily cron runs only read the newest pages (a page limit, sometimes an early stop), so
// "not seen today" means nothing. Once a week a run does a FULL PASS instead (lib/scrape.js:
// no page limit, no early stop) and touches last_seen_at on everything the source still
// lists — including listings held back by our checks. When that pass read the whole catalog,
// every live listing of the source it did not see is marked is_delisted=true and set inactive
// (off the site). One that shows up again is re-listed by the next run that sees it.
// Safety: no delisting when the pass stopped early, found far fewer listings than we have
// live (site down / page layout changed), or would take down most of the source at once —
// those wait for an admin (the run log says why). Pure parts are tested in test/delisting.test.js.

export const FULL_PASS_MAX = 5000;            // listings one full pass may read
const DAY = 86400000;
const MIN_FOUND_SHARE = 0.5;                  // pass must find ≥ half of what we have live
const MAX_DELIST_SHARE = 0.6;                 // never take down more than 60% in one go

// Is this run a full pass? run.filters.fullPass forces it (true / false); otherwise a cron
// run becomes one when the last full pass is older than config.full_pass_days (default 7).
export function isFullPassDue({ filters = {}, config = {}, trigger = 'cron', now = Date.now() } = {}) {
  if (filters?.fullPass === true) return true;
  if (filters?.fullPass === false || trigger !== 'cron') return false;
  const days = Number(config?.full_pass_days) > 0 ? Number(config.full_pass_days) : 7;
  const last = Date.parse(config?.last_full_pass_at || '');
  return !Number.isFinite(last) || now - last >= days * DAY;
}

// → null (go ahead) or the reason not to delist.
export function delistBlocker({ reachedEnd, found, live, unseen }) {
  if (!reachedEnd) return 'the pass did not read the whole catalog (stopped, limit or error)';
  if (live > 0 && found < live * MIN_FOUND_SHARE) return `found only ${found} listings at the source vs ${live} live here: site problem or layout change?`;
  if (live > 0 && unseen > live * MAX_DELIST_SHARE) return `would delist ${unseen} of ${live} live listings at once: check the source by hand`;
  return null;
}

const enc = encodeURIComponent;

// After a full pass: mark the source's live listings not seen since the run started.
// db = dbFor(country). → { delisted } or { skipped: reason }.
export async function delistUnseen({ db, source, runStartIso, reachedEnd, found, now = new Date() }) {
  // only listings that are on the site now (one an admin hid, or held for photos, is left alone)
  const base = `source_id=eq.${source.id}&is_delisted=eq.false&admin_status=eq.active`;
  const unseenQ = `${base}&or=(last_seen_at.lt.${enc(runStartIso)},last_seen_at.is.null)`;
  const [live, unseen] = await Promise.all([
    db.selectWithCount('properties', `select=id&${base}&limit=1`).then((r) => r.count || 0),
    db.selectWithCount('properties', `select=id&${unseenQ}&limit=1`).then((r) => r.count || 0),
  ]);
  const blocker = delistBlocker({ reachedEnd, found, live, unseen });
  const config = { ...(source.config || {}) };
  if (blocker) {
    config.last_full_pass_try_at = now.toISOString();
    config.last_full_pass_note = blocker;
    await db.update('scrape_sources', `id=eq.${source.id}`, { config }, { returning: 'minimal' }).catch(() => {});
    return { skipped: blocker, live, unseen };
  }
  // off the site (the website shows admin_status=active only); flagged so a re-sighting re-lists it
  if (unseen) await db.update('properties', unseenQ, { is_delisted: true, admin_status: 'inactive' }, { returning: 'minimal' });
  config.last_full_pass_at = now.toISOString();
  config.last_full_pass_delisted = unseen;
  delete config.last_full_pass_note;
  await db.update('scrape_sources', `id=eq.${source.id}`, { config }, { returning: 'minimal' }).catch(() => {});
  return { delisted: unseen, live };
}
