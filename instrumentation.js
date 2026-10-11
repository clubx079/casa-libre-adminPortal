// Runs once when the admin server starts. It starts the slowest reads in the background
// so the first person to open the admin after a deploy doesn't wait for them:
//   · the Resend sent-email list (~35 s; Email analytics tab, user Emails card)
//   · the team / Pakistan accounts list (IP locations + PostHog; Overview, Users, Emails)
// Both land in lib/swrCache.js (globalThis — shared with every route). Production only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // PERF_LOG=1: log every outgoing call (database, PostHog, Resend, …) with its time, to
  // find what makes a page slow. Off unless the env var is set.
  if (process.env.PERF_LOG === '1' && !globalThis.__clPerfFetch) {
    globalThis.__clPerfFetch = true;
    const orig = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const t0 = Date.now();
      const u = String(typeof input === 'string' ? input : input?.url || '');
      try { return await orig(input, init); } finally {
        const short = u.replace(/^https?:\/\/([^/.]+)[^/]*/, '$1').replace(/(eq|in|gte|ilike)\.[^&]*/g, '$1.…').slice(0, 140);
        console.log(`[perf] ${String(Date.now() - t0).padStart(5)}ms ${init?.method || 'GET'} ${short}`);
      }
    };
  }
  if (process.env.NODE_ENV !== 'production' || process.env.NEXT_PHASE === 'phase-production-build') return;
  const t = setTimeout(async () => {
    try {
      const [{ warmEmails }, { internalEmails }] = await Promise.all([
        import('./lib/resendEmails.js'),
        import('./lib/internalAudience.js'),
      ]);
      warmEmails();
      internalEmails(process.env.DEFAULT_COUNTRY || 'py');
    } catch (e) {
      console.error('[warm-up]', e?.message || e);
    }
  }, 10_000);
  t.unref?.();
}
