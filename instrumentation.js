// Runs once when the admin server starts. It starts the slowest reads in the background
// so the first person to open the admin after a deploy doesn't wait for them:
//   · the Resend sent-email list (~35 s; Email analytics tab, user Emails card)
//   · the team / Pakistan accounts list (IP locations + PostHog; Overview, Users, Emails)
// Both land in lib/swrCache.js (globalThis — shared with every route). Production only.
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
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
