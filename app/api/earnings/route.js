// GET /api/earnings — the active country's record of seller payments (the country picked in
// the admin's country switcher): every listing-fee / add-on transaction, paid or failed,
// with who paid, what for, the price and the listing. From our own `payments` table only
// (no Stripe calls). The page filters and adds up (lib/earnings.js). Read-only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { productOf, round } from '@/lib/earnings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const chunks = (a, n) => Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));
const inList = (ids) => `in.(${ids.map((i) => `"${String(i).replace(/"/g, '')}"`).join(',')})`;

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try {
    const { select } = dbFor(cc);
    const rows = await select('payments', 'select=id,user_id,property_id,kind,plan,amount_usd,status,created_at,card_brand,card_last4,failure_reason&kind=neq.listing_free&status=in.(succeeded,failed)&order=created_at.desc&limit=20000');
    const users = new Map();
    for (const part of chunks([...new Set(rows.map((r) => r.user_id).filter(Boolean))], 150)) {
      for (const u of await select('users', `select=id,email,full_name&id=${inList(part)}`).catch(() => [])) users.set(String(u.id), u);
    }
    const props = new Map();
    for (const part of chunks([...new Set(rows.map((r) => r.property_id).filter(Boolean))], 150)) {
      for (const p of await select('properties', `select=id,property_type,neighborhood,city&id=${inList(part)}`).catch(() => [])) props.set(String(p.id), p);
    }
    const out = rows.map((r) => {
      const u = users.get(String(r.user_id)) || {};
      const p = props.get(String(r.property_id));
      return {
        id: r.id, country: cc, user_id: r.user_id, email: u.email || null, name: u.full_name || null,
        property_id: r.property_id, listing: p ? [p.property_type, p.neighborhood || p.city].filter(Boolean).join(' · ') : (r.property_id ? 'Deleted listing' : null),
        kind: r.kind, plan: r.plan, product: productOf(r), amount_usd: round(r.amount_usd), status: r.status, created_at: r.created_at,
        card: r.card_last4 ? `${r.card_brand || 'card'} •••• ${r.card_last4}` : null, failure: r.failure_reason || null,
      };
    }).filter((r) => r.product);
    return NextResponse.json({ country: cc, rows: out, at: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json({ error: String(e.message || e).slice(0, 300) }, { status: 500 });
  }
}
