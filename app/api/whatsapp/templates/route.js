// GET /api/whatsapp/templates[?fresh=1] → the WhatsApp templates in Relay (name,
// language, category, status, body) + which automation emails use each one in the
// active country (automations.wa_templates, migration 017). Read-only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { relayTemplates, RELAY_TEMPLATES_URL } from '@/lib/relayAdmin';
import { automationSlots } from '@/lib/whatsappAdmin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const fresh = !!new URL(req.url).searchParams.get('fresh');
  let relay;
  try { relay = await relayTemplates({ fresh }); }
  catch (e) { return NextResponse.json({ configured: true, error: String(e.message || e), templates: [], relayUrl: RELAY_TEMPLATES_URL }); }
  // who uses each template here (only automations that send by WhatsApp)
  const usedBy = {};
  try {
    const db = dbFor(activeCountry());
    const [autos, emails] = await Promise.all([
      db.select('automations', 'select=*'),
      db.select('email_templates', 'select=id,name,key'),
    ]);
    for (const a of autos) {
      if (!a.channel || a.channel === 'email') continue;
      for (const s of automationSlots(a, emails)) {
        const wa = a.wa_templates?.[s.templateId];
        if (wa) (usedBy[wa] = usedBy[wa] || []).push(s.label);
      }
    }
  } catch { /* migration 017 not applied yet → nobody uses them */ }
  return NextResponse.json({ ...relay, relayUrl: RELAY_TEMPLATES_URL, templates: relay.templates.map((t) => ({ ...t, usedBy: usedBy[t.name] || [] })) });
}
