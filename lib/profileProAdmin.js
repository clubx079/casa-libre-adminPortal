// Profile Personalization pricing — admin side. The website applies it (lib/profilePro.js
// there: Settings plan box, Stripe checkout, hiding title / company / website on the listings
// after a period expires); this sets it. Same storage as Paid listings: the `automations`
// row 'profile_pro' — no table of its own, no database change:
//   enabled     → the "paid" switch (OFF / no row = free for everyone, as today)
//   free_days   → how many days one period lasts before it expires
//   milestones  → [price cents (first period), renewal price cents, first N people free]
// Periods are `payments` rows (kind profile | profile_free | profile_renew, no listing,
// highlight_until = the end). Pure — test/profileProAdmin.test.js.

export const PROFILE_PRO_ID = 'profile_pro';
export const PROFILE_KINDS = ['profile', 'profile_free', 'profile_renew'];

// Keep identical to the website's lib/profilePro.js DEFAULTS.
export const PROFILE_PRO_DEFAULTS = Object.freeze({ enabled: false, priceCents: 1000, renewCents: 1000, days: 30, firstFree: 100 });

const int = (v, min, max, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : dflt;
};

export function profileProConfig(row) {
  const D = PROFILE_PRO_DEFAULTS;
  if (!row) return { ...D, enabledAt: null };
  const m = Array.isArray(row.milestones) ? row.milestones : [];
  return {
    enabled: row.enabled === true,
    enabledAt: row.enabled_at || null,
    priceCents: int(m[0], 0, 1000000, D.priceCents),
    renewCents: int(m[1], 0, 1000000, D.renewCents),
    firstFree: int(m[2], 0, 1000000, D.firstFree),
    days: int(row.free_days, 1, 3650, D.days),
  };
}

// "12.50" | "12,5" | "US$ 12" → 1250 cents (NaN when not a price)
export function toCents(v) {
  const s = String(v ?? '').replace(/us\$|\$|\s/gi, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return NaN;
  return Math.round(Number(s) * 100);
}
export const usd = (cents) => { const v = Number(cents) / 100; return `US$${Number.isInteger(v) ? v : v.toFixed(2)}`; };

// input (the page's names): { enabled, price, renewPrice, days, firstFree } — prices in US$.
export function validateProfileProSettings(input = {}, currentRow = null, nowIso = new Date().toISOString()) {
  const cur = profileProConfig(currentRow);
  const errors = {};
  const priceCents = input.price !== undefined ? toCents(input.price) : cur.priceCents;
  if (!Number.isInteger(priceCents) || priceCents < 0 || priceCents > 1000000) errors.price = 'A price in US$, e.g. 10 or 9.99 (0 = the first period is free).';
  const renewCents = input.renewPrice !== undefined ? toCents(input.renewPrice) : cur.renewCents;
  if (!Number.isInteger(renewCents) || renewCents < 0 || renewCents > 1000000) errors.renewPrice = 'A price in US$, e.g. 10.';
  const days = input.days !== undefined ? Number(input.days) : cur.days;
  if (!Number.isInteger(days) || days < 1 || days > 3650) errors.days = 'Whole days, 1 to 3650.';
  const rawFree = input.firstFree === undefined ? cur.firstFree : (input.firstFree === '' || input.firstFree === null ? 0 : Number(input.firstFree));
  if (!Number.isInteger(rawFree) || rawFree < 0 || rawFree > 1000000) errors.firstFree = 'A whole number (0 = nobody gets it free).';
  const enabled = input.enabled !== undefined ? !!input.enabled : cur.enabled;
  const value = {
    enabled,
    free_days: errors.days ? cur.days : days,
    milestones: [errors.price ? cur.priceCents : priceCents, errors.renewPrice ? cur.renewCents : renewCents, errors.firstFree ? cur.firstFree : rawFree],
  };
  if (enabled && !cur.enabled) value.enabled_at = nowIso;
  return { ok: Object.keys(errors).length === 0, value, errors };
}

// payments rows (profile kinds) → the page's numbers.
export function profileProStats(payments = [], now = new Date()) {
  const ok = payments.filter((p) => PROFILE_KINDS.includes(p.kind) && p.status === 'succeeded');
  const lastBy = new Map();
  for (const p of ok) {
    const k = String(p.user_id);
    if (!lastBy.has(k) || String(p.highlight_until || '') > String(lastBy.get(k) || '')) lastBy.set(k, p.highlight_until || null);
  }
  const ends = [...lastBy.values()];
  const active = ends.filter((u) => u && new Date(u) > now).length;
  const revenue = ok.reduce((s, p) => s + (Number(p.amount_usd) || 0), 0);
  return {
    people: lastBy.size,
    active,
    expired: lastBy.size - active,
    firstFreeUsed: ok.filter((p) => p.kind === 'profile_free' && !Number(p.amount_usd)).length,
    paid: ok.filter((p) => Number(p.amount_usd) > 0).length,
    revenue: Math.round(revenue * 100) / 100,
  };
}
