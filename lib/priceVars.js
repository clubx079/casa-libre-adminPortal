// The REAL prices and days for an email template's preview and test email — the values the
// website puts in {{price}}, {{free_days}}, {{paid_days}}, {{free_limit}} when it sends that email,
// taken from this country's settings (Paid features → the automations row 'paid_listings') and
// lib/promoPrices.js. {{price}} means a different price per email, so it depends on which
// automation step uses the template (website lib/automations/*):
//   paid_listings  template_id / reminder_template_id ("ends soon" / "ended")  → extension price + days
//   paid_listings  gift_template_id ("plan for agents")                       → listing price
//   payment_followup, listing_held                                            → listing price + paid days
//   first_listing_free_home                                                   → home-page promotion price + gift days
// Pure — test/priceVars.test.js.
import { paidConfig, priceCents, usd } from './paidListingsAdmin.js';
import { PROMO_PRICES } from './promoPrices.js';

const has = (a, col, id) => a && a[col] != null && String(a[col]) === String(id);

export function livePriceVars(templateId, automations = []) {
  const byId = new Map((automations || []).map((a) => [a.id, a]));
  const cfg = paidConfig(byId.get('paid_listings') || null);
  const listPrice = usd(priceCents(cfg));
  const vars = { price: listPrice, paid_days: String(cfg.days), free_limit: String(cfg.freePerMonth), free_days: String(cfg.extendDays) };
  const note = [];
  const paid = byId.get('paid_listings');
  const first = byId.get('first_listing_free_home');
  if (has(paid, 'template_id', templateId) || has(paid, 'reminder_template_id', templateId)) {
    vars.price = usd(cfg.extendCents);
    vars.free_days = String(cfg.extendDays);
    note.push(`price = extension price (${vars.price} for ${cfg.extendDays} days)`);
  } else if (has(paid, 'gift_template_id', templateId) || ['payment_followup', 'listing_held'].some((k) => ['template_id', 'reminder_template_id', 'gift_template_id'].some((c) => has(byId.get(k), c, templateId)))) {
    note.push(`price = listing price (${listPrice} for ${cfg.days} days)`);
  } else if (first && ['template_id', 'reminder_template_id', 'gift_template_id'].some((c) => has(first, c, templateId))) {
    vars.price = `US$${PROMO_PRICES.home.usd}`;
    if (first.free_days) vars.free_days = String(first.free_days);
    note.push(`price = home-page promotion price (${vars.price})`);
  }
  return { vars, note: note.join(' · ') || `price = listing price (${listPrice})` };
}
