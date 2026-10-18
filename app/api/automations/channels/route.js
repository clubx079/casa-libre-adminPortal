// GET /api/automations/channels → every automation of the active country with how it
// sends (email | whatsapp | both), its email templates ("slots") and the WhatsApp
// template picked for each, plus the Relay templates to choose from.
// PUT { id, channel, wa_templates } → save it (lib/whatsappAdmin.js validateChannels:
// only approved, supported templates; WhatsApp only where the template links work).
// Migration 017 (automations.channel / wa_templates). Missing → { pending: true }.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError, q } from '@/lib/automationDb';
import { relayTemplates } from '@/lib/relayAdmin';
import { automationSlots, validateChannels, AUTOMATION_LABELS } from '@/lib/whatsappAdmin';
import { WA_TEMPLATES, WA_COUNTRIES } from '@/lib/whatsappTemplates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const missingColumn = (e) => /channel|wa_templates|PGRST204|PGRST100|42703|column/i.test(String(e?.message || e));
const ORDER = Object.keys(AUTOMATION_LABELS);

async function load(db) {
  const [autos, emails] = await Promise.all([
    db.select('automations', 'select=*'),
    db.select('email_templates', 'select=id,name,key'),
  ]);
  const setUp = autos.length > 0 && 'channel' in autos[0];
  return { setUp, emails, autos: autos.filter((a) => AUTOMATION_LABELS[a.id]).sort((a, b) => ORDER.indexOf(a.id) - ORDER.indexOf(b.id)) };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  try {
    const { setUp, emails, autos } = await load(dbFor(cc));
    let relay = { configured: false, templates: [] }; let relayError = null;
    try { relay = await relayTemplates(); } catch (e) { relayError = String(e.message || e); }
    const counts = {};
    if (setUp) {
      const logs = await dbFor(cc).select('email_log', 'select=automation_id,status&channel=eq.whatsapp&limit=10000').catch(() => []);
      for (const l of logs) { const c = (counts[l.automation_id] = counts[l.automation_id] || { sent: 0, delivered: 0, read: 0, failed: 0 }); if (c[l.status] != null) c[l.status]++; }
    }
    return NextResponse.json({
      country: cc, setUp, whatsappHere: WA_COUNTRIES.includes(cc), relayConfigured: relay.configured, relayError,
      relayTemplates: relay.templates.filter((t) => WA_TEMPLATES[t.name]),
      automations: autos.map((a) => ({
        id: a.id, label: AUTOMATION_LABELS[a.id], enabled: !!a.enabled, channel: a.channel || 'email', wa_templates: a.wa_templates || {},
        slots: automationSlots(a, emails), whatsapp: counts[a.id] || { sent: 0, delivered: 0, read: 0, failed: 0 },
      })),
    });
  } catch (e) { return dbError(e); }
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = activeCountry();
  const db = dbFor(cc);
  const body = await req.json().catch(() => ({}));
  try {
    const { setUp, emails, autos } = await load(db);
    if (!setUp) return NextResponse.json({ pending: true, error: 'migration_pending' }, { status: 409 });
    const a = autos.find((x) => x.id === body.id);
    if (!a) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    const relay = await relayTemplates({ fresh: true }).catch(() => ({ templates: [] }));
    const v = validateChannels(body, { automation: a, slots: automationSlots(a, emails), relay: relay.templates, country: cc });
    if (!v.ok) return NextResponse.json(v, { status: 400 });
    await db.update('automations', `id=eq.${q(a.id)}`, { ...v.value, updated_at: new Date().toISOString() }, { returning: 'minimal' });
    return NextResponse.json({ ok: true, ...v.value });
  } catch (e) {
    if (missingColumn(e)) return NextResponse.json({ pending: true, error: 'migration_pending' }, { status: 409 });
    return dbError(e);
  }
}
