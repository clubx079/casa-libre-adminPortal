// Abandoned checkouts: someone opened the card form (buyer site lib/billing.js writes a
// payments row with status 'started' and the Stripe PaymentIntent) and no 'succeeded' row
// for that PaymentIntent followed within an hour. Used by the Paid listings page and the
// Admin Manager's data pack, so both count the same way. Pure — test/checkouts.test.js.
export const ABANDON_AFTER_MS = 3600 * 1000;

export function abandonedCheckouts(payments = [], { now = Date.now(), from = null, to = null } = {}) {
  const paid = new Set(payments.filter((p) => p.status === 'succeeded' && p.stripe_payment_intent_id).map((p) => p.stripe_payment_intent_id));
  const inWindow = (p) => {
    const t = Date.parse(p.created_at);
    return Number.isFinite(t) && (from == null || t >= Date.parse(from)) && (to == null || t < Date.parse(to));
  };
  const started = payments.filter((p) => p.status === 'started' && inWindow(p));
  const abandoned = started.filter((p) => !paid.has(p.stripe_payment_intent_id) && now - Date.parse(p.created_at) >= ABANDON_AFTER_MS);
  return { started, abandoned };
}

// What the checkout was for, in words.
export const checkoutLabel = (kind, plan) => ({
  listing: 'Extra listing', listing_extend: 'Listing extension',
  highlight: plan === 'home' ? 'Home page promotion' : plan === 'verified' ? 'Verified badge' : 'Promotion',
  renewal: 'Promotion renewal',
}[kind] || kind || 'Payment');
