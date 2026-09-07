// In-run cost circuit breaker for Casa Libre scrapes (parity with DeelMap's).
// Checked once per listing inside the scrape loop, it aborts a run for either of
// two reasons — bounding a single run's Google Vision spend even if the
// source_hash dedup somehow stops skipping:
//
//   1. RUNAWAY CAP — once more than CASALIBRE_MAX_VISION_IMAGES_PER_RUN images
//      (default 2500) have been sent to Vision this run (the paid path), abort.
//   2. KILL SWITCH — if the source's scrape_sources.cron_enabled has been flipped
//      to false mid-run (the hourly usage monitor does this on a cost spike),
//      abort within ~60s (throttled re-read).
//
// Normal server runtime (not a workflow script) → Date.now() is available.
// `selectFn` is injected (scrape.js passes its ./db select) so this module is
// dependency-free and unit-testable with a fake.

const MAX_IMAGES = Math.max(200, Number(process.env.CASALIBRE_MAX_VISION_IMAGES_PER_RUN || 2500));
const KILL_TTL_MS = 60_000;

export function makeCostBreaker(sourceKey, selectFn) {
  let images = 0;
  let killed = null;
  let modeAt = 0;
  let disabled = false;

  return {
    recordImages(n) { images += Math.max(0, Number(n) || 0); },
    imagesScreened() { return images; },
    maxImages: MAX_IMAGES,

    // Returns a reason string to abort the run, or null to continue.
    async shouldAbort() {
      if (killed) return killed;
      if (images >= MAX_IMAGES) {
        killed = `circuit breaker: ${images} images sent to Vision this run (cap ${MAX_IMAGES}) — aborting to bound cost`;
        return killed;
      }
      const now = Date.now();
      if (selectFn && now - modeAt > KILL_TTL_MS) {
        modeAt = now;
        try {
          const rows = await selectFn('scrape_sources', `select=cron_enabled&key=eq.${encodeURIComponent(sourceKey)}`);
          disabled = !!(rows && rows[0] && rows[0].cron_enabled === false);
        } catch { /* transient read error → don't abort on it */ }
      }
      if (disabled) {
        killed = `kill switch: scrape_sources.cron_enabled=false for "${sourceKey}" — aborting run`;
        return killed;
      }
      return null;
    },
  };
}
