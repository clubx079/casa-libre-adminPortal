import { describe, it, expect } from 'vitest';
import { userWhatsApp } from '../lib/userWhatsApp.js';

describe('userWhatsApp (one person\'s WhatsApp card)', () => {
  const rows = [
    { id: 1, status: 'read', subject: 'WhatsApp · cl_borrador', template_key: 'draft-reminder', to_phone: '+595981990001', created_at: '2026-10-20T10:00:00Z' },
    { id: 2, status: 'delivered', subject: 'WhatsApp · cl_visitas', template_key: 'listing-views', to_phone: '+595981990001', created_at: '2026-10-21T10:00:00Z' },
    { id: 3, status: 'failed', subject: 'WhatsApp · cl_repetida', template_key: 'duplicate-listing', created_at: '2026-10-19T10:00:00Z' },
    { id: 4, status: 'sending', subject: 'WhatsApp · cl_repetida', template_key: 'duplicate-listing', created_at: '2026-10-22T10:00:00Z' },
  ];
  it('newest first, readable type, status, and which message was clicked', () => {
    const r = userWhatsApp(rows, { cl_borrador: 2 }, { 'draft-reminder': 'Draft reminder' });
    expect(r.messages.map((m) => m.id)).toEqual([2, 1, 3]);   // still-sending left out
    expect(r.messages[1]).toMatchObject({ type: 'Draft reminder', template: 'cl_borrador', status: 'read', clicked: true });
    expect(r.messages[0].clicked).toBe(false);
    expect(r.summary).toMatchObject({ sent: 3, delivered: 2, read: 1, failed: 1, clicked: 2, readRate: 50 });
  });
  it('nothing sent → zeros', () => {
    expect(userWhatsApp([], {}).summary).toMatchObject({ sent: 0, delivered: 0, read: 0, clicked: 0, readRate: null });
  });
});
