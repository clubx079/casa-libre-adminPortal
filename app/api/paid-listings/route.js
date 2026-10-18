// GET /api/paid-listings → the active country's paid-listings settings (lib/paidListingsAdmin.js),
//                          the email templates to pick from, this month's numbers, the
//                          listings waiting for payment / paid / ended, and the accounts
//                          that look like the same person.
// PUT /api/paid-listings → save the settings / switch the paywall on or off. The first
//                          save creates the settings row and the three default emails.
// Nothing is written to a country's database until an admin saves here.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError, q, EMAIL_ONLY } from '@/lib/automationDb';
import { PAID_LISTINGS_ID, paidConfig, priceCents, usd, validatePaidSettings, DEFAULT_TEMPLATES, samePersonGroups, paidStats } from '@/lib/paidListingsAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TZ = { py: 'America/Asuncion', bo: 'America/La_Paz', uy: 'America/Montevideo', ve: 'America/Caracas', sv: 'America/El_Salvador' };
function monthStartIso(cc, now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ[cc] || TZ.py, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(now.getTime() / 1000) * 1000;
  return new Date(Date.UTC(+p.year, +p.month - 1, 1) - offset).toISOString();
}
const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

async function payload(db, cc) {
  const [rows, templates] = await Promise.all([
    db.select('automations', `select=*&id=eq.${PAID_LISTINGS_ID}&limit=1`),
    db.select('email_templates', 'select=id,name,key,subject,is_active&order=created_at.asc'),
  ]);
  const row = rows[0] || null;
  const cfg = paidConfig(row);
  const monthStart = monthStartIso(cc);
  const since = new Date(Date.now() - 180 * 86400000).toISOString();
  const [payments, props, sent] = await Promise.all([
    db.select('payments', 'select=id,user_id,property_id,kind,amount_usd,status,created_at,highlight_until&kind=in.(listing,listing_extend,listing_free)&order=created_at.desc&limit=5000').catch(() => []),
    db.select('properties', `select=id,created_by,created_at,status,admin_status,raw_data,property_type,listing_type,neighborhood,city&origin=eq.user&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=5000`).catch(() => []),
    db.selectWithCount('email_log', `select=id&automation_id=eq.${PAID_LISTINGS_ID}&status=eq.sent&limit=1&${EMAIL_ONLY}`).catch(() => ({ count: 0 })),
  ]);
  // Older paid listings (created before the 180-day window) still count as paid.
  const paidIds = [...new Set(payments.filter((p) => p.property_id && p.kind !== 'listing_free').map((p) => String(p.property_id)))];
  const have = new Set(props.map((p) => String(p.id)));
  const missing = paidIds.filter((id) => !have.has(id));
  const older = missing.length ? await db.select('properties', `select=id,created_by,created_at,status,admin_status,raw_data,property_type,listing_type,neighborhood,city&id=${inList(missing.slice(0, 300))}`).catch(() => []) : [];
  const all = [...props, ...older];

  const groups = samePersonGroups(all, cfg.samePersonMin);
  const listed = all.filter((p) => p.status === 'payment_pending' || p.status === 'expired' || p.raw_data?.paid_listing).slice(0, 100);
  const userIds = [...new Set([...listed.map((p) => p.created_by), ...groups.flatMap((g) => g.users)].filter(Boolean).map(String))];
  const users = userIds.length ? await db.select('users', `select=id,email,full_name,created_at&id=${inList(userIds.slice(0, 300))}`).catch(() => []) : [];
  const uById = new Map(users.map((u) => [String(u.id), u]));
  const freeThisMonthBy = new Map();
  for (const p of all) if (String(p.created_at) >= monthStart && !p.raw_data?.paid_listing) freeThisMonthBy.set(String(p.created_by), (freeThisMonthBy.get(String(p.created_by)) || 0) + 1);
  const who = (id) => { const u = uById.get(String(id)) || {}; return { id, email: u.email || null, name: u.full_name || null }; };

  return {
    setUp: !!row,
    settings: { ...cfg, listPrice: (cfg.listCents / 100).toFixed(2), extendPrice: (cfg.extendCents / 100).toFixed(2), price: usd(priceCents(cfg)), priceCents: priceCents(cfg) },
    templates,
    monthStart,
    emailsSent: sent.count || 0,
    stats: paidStats({ payments, props: all, monthStart }),
    listings: listed.map((p) => ({
      id: p.id, created_at: p.created_at, status: p.status, admin_status: p.admin_status,
      state: p.status === 'payment_pending' ? 'pending' : p.raw_data?.paid_listing?.state || null,
      until: p.raw_data?.paid_listing?.until || null,
      title: [p.property_type, p.listing_type === 'rent' ? 'rent' : 'sale', p.neighborhood || p.city].filter(Boolean).join(' · '),
      owner: who(p.created_by),
    })),
    samePerson: groups.map((g) => ({ matched: g.matched, users: g.users.map((id) => ({ ...who(id), freeThisMonth: freeThisMonthBy.get(String(id)) || 0 })) })),
  };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try { return NextResponse.json({ ...(await payload(dbFor(cc), cc)), country: cc }); }
  catch (e) { return dbError(e); }
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const db = dbFor(cc);
  const body = await req.json().catch(() => ({}));
  try {
    const [cur] = await db.select('automations', `select=*&id=eq.${PAID_LISTINGS_ID}&limit=1`);
    // First save: the three default emails (if this country doesn't have them yet), so
    // every email step has a template to start from.
    const input = { ...body };
    if (!cur) {
      const existing = await db.select('email_templates', 'select=id,key');
      for (const t of DEFAULT_TEMPLATES) {
        let id = existing.find((e) => e.key === t.key)?.id;
        if (!id) {
          const { col, ...tpl } = t;
          const [made] = await db.insert('email_templates', [{ ...tpl, is_active: true }]);
          id = made?.id;
        }
        const field = { template_id: 'endingTemplateId', reminder_template_id: 'endedTemplateId', gift_template_id: 'agentTemplateId' }[t.col];
        if (input[field] === undefined || input[field] === null || input[field] === '') input[field] = id;
      }
    }
    const v = validatePaidSettings(input, cur || null);
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    const now = new Date().toISOString();
    if (cur) await db.update('automations', `id=eq.${q(PAID_LISTINGS_ID)}`, { ...v.value, updated_at: now }, { returning: 'minimal' });
    else await db.insert('automations', [{ id: PAID_LISTINGS_ID, wait_days: 0, ...v.value, updated_at: now }], { returning: 'minimal' });
    return NextResponse.json({ ...(await payload(db, cc)), country: cc, saved: true });
  } catch (e) { return dbError(e); }
}
