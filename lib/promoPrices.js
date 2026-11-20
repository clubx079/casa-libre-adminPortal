// The two optional paid extras on a listing — ONE place in the admin for their prices.
// The website charges them from lib/stripe.js PROMO (verified US$5, home US$20, 30 days): keep
// these numbers equal to that file when a price changes there. Used by the Inbox AI's fact sheet
// and prompt (lib/aiFacts.js, lib/aiPrompt.js) and the email-template preview (lib/priceVars.js).
export const PROMO_DAYS = 30;
export const PROMO_PRICES = {
  verified: { usd: 5, label: 'Insignia Verificada' },
  home: { usd: 20, label: 'Portada (página de inicio + Verificada)' },
};
export const promoText = (plan) => `US$${PROMO_PRICES[plan]?.usd ?? PROMO_PRICES.verified.usd} · ${PROMO_DAYS} días`;
