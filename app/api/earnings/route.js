// GET /api/earnings — money received in every country this admin can see (lib/earnings.js):
// per month × product × country, plus the latest payments. Read-only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { allowedCountryCodes } from '@/lib/adminCountry';
import { summarize, productOf } from '@/lib/earnings';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const ALL = ['py', 'bo', 'uy', 've'];

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const allowed = allowedCountryCodes();
  const codes = ALL.filter((c) => (!allowed || !allowed.length || allowed.includes(c)) && (c === 'py' || process.env[`AIROBASE_URL_${c.toUpperCase()}`]));
  const errors = {};
  const perCountry = await Promise.all(codes.map(async (cc) => {
    try {
      const { select } = dbFor(cc);
      const rows = await select('payments', 'select=id,user_id,property_id,kind,plan,amount_usd,status,created_at,card_brand,card_last4&status=eq.succeeded&kind=neq.listing_free&order=created_at.desc&limit=10000');
      const ids = [...new Set(rows.slice(0, 60).map((r) => r.user_id).filter(Boolean))];
      const users = ids.length ? await select('users', `select=id,email&id=in.(${ids.map((i) => `"${i}"`).join(',')})`).catch(() => []) : [];
      const email = new Map(users.map((u) => [String(u.id), u.email]));
      return rows.map((r) => ({ ...r, country: cc, email: email.get(String(r.user_id)) || null }));
    } catch (e) { errors[cc] = String(e.message || e).slice(0, 200); return []; }
  }));
  const rows = perCountry.flat();
  const recent = [...rows].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))).slice(0, 50)
    .map((r) => ({ id: r.id, created_at: r.created_at, country: r.country, product: productOf(r), amount_usd: Number(r.amount_usd), email: r.email, card: r.card_last4 ? `${r.card_brand || 'card'} •••• ${r.card_last4}` : null }));
  return NextResponse.json({ countries: codes, ...summarize(rows), recent, errors });
}
