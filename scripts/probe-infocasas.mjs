// Live dry-run probe for the InfoCasas adapter — Task 5 "test small" gate.
// Maps ~20 real Asunción/sale listings via fetchPage + mapListing and prints
// them as JSON lines. Writes NOTHING to any database, calls no AI/B2 service.
import infocasas from '../lib/adapters/infocasas.js';
const source = { id: 'DRYRUN', key: 'infocasas', base_url: 'https://www.infocasas.com.py' };
const ctx = { source, config: { shard: { operation_type_id: 1, estate_id: 21 } }, pygPerUsd: 7300 };
const { items } = await infocasas.fetchPage(ctx.config, {}, 0, 20);
let withPhone = 0;
for (const it of items) {
  const m = infocasas.mapListing(it, ctx);
  if (m.row.contact_phone) withPhone++;
  console.log(JSON.stringify({
    id: m.external_id, addr: m.row.address, price: m.row.price, cur: m.row.currency, usd: m.row.price_usd,
    type: m.row.property_type, op: m.row.listing_type, beds: m.row.bedrooms, baths: m.row.bathrooms,
    area: m.row.covered_area || m.row.land_area, zone: m.row.neighborhood, phone: m.row.contact_phone, imgs: m.images.length,
  }));
}
console.log(`\nPHONE CAPTURE: ${withPhone}/${items.length}`);
