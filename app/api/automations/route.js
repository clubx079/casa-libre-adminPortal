// GET /api/automations → the "first listing → free home display" automation for the
//                        active country: settings, template choices, stats, latest runs.
// PUT /api/automations → change settings / switch on-off (switching on stamps
//                        enabled_at: only first listings created after it count).
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { AUTOMATION_ID, VIEWS_AUTOMATION_ID, validateSettings, validateViewsSettings, automationStats } from '@/lib/automationAdmin';
import { dbError, q } from '@/lib/automationDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const inList = (ids) => `in.(${ids.map((id) => `"${String(id).replace(/"/g, '')}"`).join(',')})`;

async function payload(db) {
  const [[automation], templates, runs] = await Promise.all([
    db.select('automations', `select=*&id=eq.${AUTOMATION_ID}&limit=1`),
    db.select('email_templates', 'select=id,name,key,subject,is_active&order=created_at.asc'),
    db.select('automation_runs', `select=*&automation_id=eq.${AUTOMATION_ID}&order=created_at.desc&limit=2000`),
  ]);
  if (!automation) return { missing: true };
  // "Listing getting views" (migration 006). Missing → the page explains how to add it.
  let views = null;
  try {
    const [va] = await db.select('automations', `select=*&id=eq.${VIEWS_AUTOMATION_ID}&limit=1`);
    if (va && 'milestones' in va) {
      const sent = await db.selectWithCount('email_log', `select=id&automation_id=eq.${VIEWS_AUTOMATION_ID}&status=eq.sent&limit=1`).catch(() => ({ count: 0 }));
      views = { automation: va, sent: sent.count || 0 };
    }
  } catch { views = null; }
  const convertedIds = runs.filter((r) => r.status === 'converted').map((r) => r.property_id).filter(Boolean);
  const payments = convertedIds.length
    ? await db.select('payments', `select=property_id,amount_usd,created_at,status&status=eq.succeeded&property_id=${inList(convertedIds)}`).catch(() => [])
    : [];
  const recent = runs.slice(0, 20);
  const userIds = [...new Set(recent.map((r) => r.user_id))];
  const propIds = [...new Set(recent.map((r) => r.property_id).filter(Boolean))];
  const [users, props] = await Promise.all([
    userIds.length ? db.select('users', `select=id,email,full_name&id=${inList(userIds)}`).catch(() => []) : [],
    propIds.length ? db.select('properties', `select=id,property_type,neighborhood,city&id=${inList(propIds)}`).catch(() => []) : [],
  ]);
  const uById = new Map(users.map((u) => [String(u.id), u]));
  const pById = new Map(props.map((p) => [String(p.id), p]));
  return {
    automation,
    views,
    templates,
    stats: automationStats(runs, payments),
    recent: recent.map((r) => {
      const u = uById.get(String(r.user_id)) || {};
      const p = pById.get(String(r.property_id)) || {};
      return {
        id: r.id, status: r.status, skip_reason: r.skip_reason, last_error: r.last_error,
        gifted_at: r.gifted_at, free_until: r.free_until, reminded_at: r.reminded_at, converted_at: r.converted_at, created_at: r.created_at,
        user: u.full_name || u.email || String(r.user_id).slice(0, 8), email: u.email || null,
        property_id: r.property_id,
        property: [p.property_type, p.neighborhood || p.city].filter(Boolean).join(' · ') || (r.property_id ? String(r.property_id).slice(0, 8) : '—'),
      };
    }),
  };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try {
    const data = await payload(dbFor(activeCountry()));
    if (data.missing) return NextResponse.json({ pending: true, error: 'migration_pending' });
    return NextResponse.json({ ...data, country: activeCountry() });
  } catch (e) { return dbError(e); }
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const db = dbFor(activeCountry());
  const body = await req.json().catch(() => ({}));
  try {
    if (body.id === VIEWS_AUTOMATION_ID) {
      const [cur] = await db.select('automations', `select=*&id=eq.${VIEWS_AUTOMATION_ID}&limit=1`);
      if (!cur) return NextResponse.json({ pending: true, error: 'migration_pending' });
      const { id, ...patch } = body;
      const v = validateViewsSettings(patch, cur);
      if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
      await db.update('automations', `id=eq.${q(VIEWS_AUTOMATION_ID)}`, { ...v.value, updated_at: new Date().toISOString() }, { returning: 'minimal' });
      return NextResponse.json({ ...(await payload(db)), country: activeCountry() });
    }
    const [current] = await db.select('automations', `select=*&id=eq.${AUTOMATION_ID}&limit=1`);
    if (!current) return NextResponse.json({ pending: true, error: 'migration_pending' });
    const v = validateSettings(body, current);
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    // A step can't be switched on without a template to send.
    const next = { ...current, ...v.value };
    if (next.enabled && (!next.gift_template_id || !next.reminder_template_id)) {
      return NextResponse.json({ error: 'invalid', errors: { enabled: 'Pick a template for both emails before switching it on.' } }, { status: 400 });
    }
    await db.update('automations', `id=eq.${q(AUTOMATION_ID)}`, { ...v.value, updated_at: new Date().toISOString() }, { returning: 'minimal' });
    return NextResponse.json({ ...(await payload(db)), country: activeCountry() });
  } catch (e) { return dbError(e); }
}
