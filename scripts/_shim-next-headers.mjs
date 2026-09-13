// CLI shim for `next/headers` so server libs (adminCountry/auth/lang) can be
// imported outside a Next request scope. Any actual call throws and is caught by
// the callers' try/catch (they fall back to DEFAULT_COUNTRY etc.). The scrape
// runner always passes an explicit country, so these are never really invoked.
export function cookies() { throw new Error('cookies() called outside a request scope (CLI shim)'); }
export function headers() { throw new Error('headers() called outside a request scope (CLI shim)'); }
export function draftMode() { throw new Error('draftMode() called outside a request scope (CLI shim)'); }
