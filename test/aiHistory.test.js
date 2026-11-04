import { describe, it, expect } from 'vitest';
import { historyLines } from '../lib/aiHistory';

const row = (automation_id, created_at, extra = {}, m = null) => ({ automation_id, created_at, channel: 'email', status: 'sent', ...extra, error: m ? JSON.stringify(m) : null });

describe('the assistant sees the person\'s whole history', () => {
  it('one short line per event, newest first', () => {
    const lines = historyLines({
      rows: [
        row('inbox_ai', '2026-11-01T10:00:00Z', { channel: 'whatsapp', status: 'read' }, { question: '¿Cómo publico?', english: 'Go to the link and upload your photos', goal: 'publish' }),
        row('inbox_ai_person', '2026-11-02T10:00:00Z', { channel: 'whatsapp', status: 'test' }, { question: 'Quiero mi plata', note: 'asks for a refund' }),
        row('open_issue', '2026-11-03T10:00:00Z', {}, { by: 'omar', action: 'gift' }),
        row('draft_reminders', '2026-10-30T10:00:00Z', { subject: 'Tu publicación quedó a medio cargar' }),
        row('manager_views', '2026-10-29T10:00:00Z', { channel: 'whatsapp', status: 'delivered' }, { views: 23, contacts: 0 }),
        row('wa_campaign', '2026-10-28T10:00:00Z', { channel: 'whatsapp', template_key: 'cl_agentes_respuesta' }, { keyword: 'si' }),
        row('wa_campaign', '2026-10-28T09:00:00Z', { channel: 'wa_campaign' }),
        row('draft_reminders', '2026-10-27T10:00:00Z', { status: 'test' }),
      ],
      feedback: [{ created_at: '2026-10-31T10:00:00Z', rating: 2, message: 'No me llaman' }],
    });
    expect(lines).toEqual([
      '2026-11-03 · Team (omar) published their waiting listings FREE as a gift',
      '2026-11-02 · AI assistant passed it to a person (asks for a refund); they asked “Quiero mi plata”',
      '2026-11-01 · AI assistant answered “¿Cómo publico?” → “Go to the link and upload your photos” (asked them to: publish) [read]',
      '2026-10-31 · Their feedback 2/5 stars: “No me llaman”',
      '2026-10-30 · Automation "draft_reminders" email: Tu publicación quedó a medio cargar',
      '2026-10-29 · Admin Manager sent the price / photos advice by WhatsApp (23 views, 0 contacts) [delivered]',
      '2026-10-28 · Campaign WhatsApp cl_agentes_respuesta — they tapped SI',
    ]);
  });
  it('caps the length', () => {
    const rows = Array.from({ length: 80 }, (_, k) => row('draft_reminders', new Date(Date.UTC(2026, 9, 1) + k * 3600000).toISOString(), { subject: `r${k}` }));
    expect(historyLines({ rows, max: 40 })).toHaveLength(40);
  });
});
