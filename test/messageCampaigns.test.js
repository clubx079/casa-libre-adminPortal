import { describe, it, expect } from 'vitest';
import { summarizeCampaigns, keyForEmailType, infoFor, CATALOG, GROUPS } from '../lib/messageCampaigns.js';
import { emailType } from '../lib/emailStats.js';

const now = Date.parse('2026-11-21T12:00:00Z');
const ago = (d) => new Date(now - d * 86400000).toISOString();

describe('summarizeCampaigns', () => {
  const logs = [
    { automation_id: 'profile_personalization', channel: 'email', status: 'sent', resend_id: 'r1', subject: 'Tu perfil de Casa-Libre está al 29 %', created_at: ago(1) },
    { automation_id: 'profile_personalization', channel: 'email', status: 'sent', resend_id: 'r2', subject: 'Tu perfil de Casa-Libre está al 40 %', created_at: ago(2) },
    { automation_id: 'profile_personalization', channel: 'email', status: 'sent', resend_id: 'r3', subject: 'x', created_at: ago(9) },
    { automation_id: 'draft_reminders', channel: 'whatsapp', status: 'read', subject: 'WhatsApp · cl_borrador', created_at: ago(1) },
    { automation_id: 'draft_reminders', channel: 'whatsapp', status: 'delivered', subject: 'WhatsApp · cl_borrador', created_at: ago(8) },
    { automation_id: 'wa_campaign', channel: 'wa_campaign', status: 'sending', created_at: ago(1) },        // a batch record, not a message
    { automation_id: 'referrals', channel: 'event', status: 'sent', created_at: ago(1) },                   // an event, not a message
    { automation_id: 'inbox_ai', channel: 'whatsapp', status: 'read', created_at: ago(1) },                 // a conversation reply
  ];
  const resend = [
    { id: 'r1', subject: 'a', last_event: 'clicked', created_at: ago(1) },
    { id: 'r2', subject: 'b', last_event: 'delivered', created_at: ago(2) },
    { id: 'r3', subject: 'c', last_event: 'opened', created_at: ago(9) },
    { id: 's1', subject: '123456 es tu código de Casa-Libre', last_event: 'delivered', created_at: ago(1) },
    { id: 's2', subject: 'Something we sent once', last_event: 'opened', created_at: ago(3) },
  ];
  const out = summarizeCampaigns({ logs, resend, range: 30, now, waClicks: [{ key: 'draft_reminders', week: 'w', inRange: true, n: 1 }] });
  const by = Object.fromEntries(out.campaigns.map((c) => [c.key, c]));

  it('names every message: no "Other"', () => {
    expect(Object.keys(by).sort()).toEqual(['draft_reminders', 'profile_personalization', 'site:One-off', 'site:Sign-in code']);
    expect(by['site:One-off'].subjects[0].subject).toBe('Something we sent once');
  });
  it('counts email opens and clicks from Resend, week by week', () => {
    const p = by.profile_personalization;
    expect(p.email).toMatchObject({ sent: 3, opened: 2, clicked: 1, openRate: 66.7 });
    expect(p.week.email.w).toMatchObject({ sent: 2, opened: 1, clicked: 1 });
    expect(p.week.email.p).toMatchObject({ sent: 1, opened: 1 });
  });
  it('counts WhatsApp read and clicks', () => {
    const d = by.draft_reminders;
    expect(d.wa).toMatchObject({ sent: 2, delivered: 2, read: 1, clicked: 1, readRate: 50 });
    expect(d.week.wa.w).toMatchObject({ sent: 1, read: 1, clicked: 1 });
  });
  it('totals leave out site emails', () => {
    expect(out.totals.email.range.sent).toBe(3);
    expect(out.totals.wa.w.sent).toBe(1);
  });
});

describe('catalog', () => {
  it('the automations that were "Other" have a type now', () => {
    expect(keyForEmailType(emailType('Casa-Libre: ahora tu foto y tus datos aparecen en tus avisos'))).toBe('profile_personalization');
    expect(keyForEmailType(emailType('Recordatorio: Carlos, un detalle en tu depto'))).toBe('manager');
    expect(keyForEmailType(emailType('Tu foto de perfil puede traerte más consultas'))).toBe('profile_photo_face');
    expect(keyForEmailType(emailType('Lamentamos que te vayas, Omar'))).toBe('account_deleted');
  });
  it('every catalog entry has a known group', () => {
    const groups = new Set(GROUPS.map((g) => g.key));
    for (const v of Object.values(CATALOG)) expect(groups.has(v.group)).toBe(true);
    expect(infoFor('new_thing').label).toBe('New thing');
  });
});
