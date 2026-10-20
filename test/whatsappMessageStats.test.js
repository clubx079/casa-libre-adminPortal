import { describe, it, expect } from 'vitest';
import { summarizeWhatsApp, verificationsInPeriod, templateOf } from '../lib/whatsappMessageStats.js';
import { verificationStats } from '../lib/userInsights.js';
import { samePersonGroups, toE164 } from '../lib/paidListingsAdmin.js';

describe('summarizeWhatsApp', () => {
  const rows = [
    { status: 'read', subject: 'WhatsApp · cl_visitas', created_at: '2026-10-20T10:00:00Z' },
    { status: 'delivered', subject: 'WhatsApp · cl_visitas', created_at: '2026-10-20T11:00:00Z' },
    { status: 'sent', subject: 'WhatsApp · cl_borrador', created_at: '2026-10-21T09:00:00Z' },
    { status: 'failed', subject: 'WhatsApp · cl_borrador', created_at: '2026-10-21T09:05:00Z' },
    { status: 'sending', subject: 'WhatsApp · cl_borrador', created_at: '2026-10-21T09:06:00Z' },
  ];
  it('counts sent / delivered / read / failed per template, skips messages still sending', () => {
    const s = summarizeWhatsApp(rows, { cl_visitas: 1 });
    expect(s.totals).toMatchObject({ sent: 4, delivered: 2, read: 1, failed: 1, clicked: 1, readRate: 50, clickRate: 50 });
    const v = s.byTemplate.find((t) => t.template === 'cl_visitas');
    expect(v).toMatchObject({ sent: 2, delivered: 2, read: 1, clicked: 1 });
    expect(s.byDay.map((d) => d.day)).toEqual(['2026-10-20', '2026-10-21']);
  });
  it('clicks for a template with no message in the window still show', () => {
    const s = summarizeWhatsApp([], { cl_destacado_inicio: 3 });
    expect(s.totals.clicked).toBe(3);
    expect(s.byTemplate[0]).toMatchObject({ template: 'cl_destacado_inicio', sent: 0, clicked: 3, clickRate: null });
  });
  it('template name from the log subject', () => {
    expect(templateOf({ subject: 'WhatsApp · cl_repetida' })).toBe('cl_repetida');
    expect(templateOf({})).toBe('other');
  });
});

describe('verification (main identity) counts', () => {
  const users = [
    { verified: true, auth_provider: 'whatsapp', phone_verified_at: '2026-10-20T00:00:00Z', created_at: '2026-10-20T00:00:00Z' },       // WhatsApp, email unconfirmed
    { verified: true, auth_provider: 'whatsapp_email', phone_verified_at: '2026-10-01T00:00:00Z', created_at: '2026-10-01T00:00:00Z' }, // both
    { verified: true, auth_provider: 'email', phone_verified_at: null, created_at: '2026-10-19T00:00:00Z' },                                 // email only
    { verified: true, auth_provider: 'google', phone_verified_at: null, created_at: '2026-10-20T00:00:00Z' },
    { verified: true, auth_provider: 'apple', phone_verified_at: null, created_at: '2026-10-20T00:00:00Z' },
    { verified: true, auth_provider: 'email', phone_verified_at: '2026-10-21T00:00:00Z', created_at: '2026-09-01T00:00:00Z' },               // email user who added WhatsApp
    { verified: false, auth_provider: 'pending', created_at: '2026-10-20T00:00:00Z' },                                                        // not a user yet
  ];
  it('all time: WhatsApp only / email only / both / Google / Apple / unconfirmed emails', () => {
    expect(verificationStats(users)).toEqual({ whatsapp: 3, email: 5, both: 2, whatsappOnly: 1, emailOnly: 3, google: 1, apple: 1, unconfirmedEmail: 1 });
  });
  it('in a period: new WhatsApp verifications vs new email / Google / Apple sign-ups', () => {
    expect(verificationsInPeriod(users, '2026-10-15T00:00:00Z')).toEqual({ whatsapp: 2, email: 1, google: 1, apple: 1 });
  });
});

describe('same person by phone (admin groups)', () => {
  it('normalizes local and international numbers alike', () => {
    expect(toE164('0981 123 456', '595')).toBe('+595981123456');
    expect(toE164('+595 981-123-456', '595')).toBe('+595981123456');
    expect(toE164('595981123456', '595')).toBe('+595981123456');
  });
  it('joins accounts with the same listing phone, or a listing phone = another account\'s verified WhatsApp', () => {
    const g = samePersonGroups([
      { created_by: 'u1', contact_phone: '0981123456' },
      { created_by: 'u2', contact_phone: '+595981123456', raw_data: { signals: { ip: '1.1.1.1' } } },
      { created_by: 'u3', contact_phone: '0972 222 222' },
    ], 2, { prefix: '595', verified: [{ id: 'u4', phone: '+595972222222' }] });
    expect(g).toHaveLength(2);
    expect(g.find((x) => x.users.includes('u1'))).toMatchObject({ users: ['u1', 'u2'], matched: ['phone'] });
    expect(g.find((x) => x.users.includes('u3'))).toMatchObject({ users: ['u3', 'u4'], matched: ['phone'] });
  });
  it('device signals still work as before (2 of 3)', () => {
    const g = samePersonGroups([
      { created_by: 'a', raw_data: { signals: { device_id: 'd1', ip: '1.1.1.1' } } },
      { created_by: 'b', raw_data: { signals: { device_id: 'd1', ip: '1.1.1.1' } } },
    ], 2);
    expect(g).toEqual([{ users: ['a', 'b'], matched: ['device_id', 'ip'] }]);
  });
});
