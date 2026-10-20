import { describe, it, expect } from 'vitest';
import { toE164, cleanAudience, audienceCounts, neededFields, missingValue, relayVariables, variablesProblem, previewText, campaignSlug, matchCampaignMessage, campaignResults } from '../lib/waCampaigns.js';

describe('audience', () => {
  it('cleans phones, de-duplicates, keeps the first name', () => {
    const a = cleanAudience([{ phone: '0981 123 456', name: 'Ana Pérez' }, { phone: '+595981123456', name: 'dup' }, { phone: '12' }, { phone: '+15035551234' }], '595');
    expect(a.invalid).toBe(1);
    expect(a.recipients.map((r) => r.phone)).toEqual(['+595981123456', '+15035551234']);
    expect(a.recipients[0]).toMatchObject({ name: 'Ana Pérez', first_name: 'Ana' });
    expect(toE164('595981123456')).toBe('+595981123456');
  });
  it('only opted-in contacts will receive it (Relay rule); +1 skipped for marketing', () => {
    const rec = ['+595981000001', '+595981000002', '+595981000003', '+595981000004', '+15035551234'].map((phone) => ({ phone }));
    const optIn = new Map([['+595981000001', 'opted_in'], ['+595981000002', 'opted_out'], ['+595981000004', 'opted_in'], ['+15035551234', 'opted_in']]);
    expect(audienceCounts(rec, optIn, new Set(['+595981000004']), { marketing: true })).toEqual({ total: 5, willReceive: 1, noOptIn: 1, optedOut: 2, usMarketing: 1, missingValue: 0 });
    expect(audienceCounts(rec, optIn, new Set(), { marketing: false }).willReceive).toBe(3);
  });
  it('contacts missing a mapped value are skipped (Relay rule)', () => {
    const map = { body: [{ source: 'contact.first_name' }, { source: 'static', text: 'x' }], button: { source: 'contact.email' } };
    expect(neededFields(map).sort()).toEqual(['email', 'first_name']);
    expect(missingValue({ first_name: 'Ana', email: '' }, ['first_name', 'email'])).toBe(true);
    const rec = [{ phone: '+595981000001', first_name: 'Ana', email: 'a@x.com' }, { phone: '+595981000002', first_name: null, email: 'b@x.com' }];
    const opt = new Map(rec.map((r) => [r.phone, 'opted_in']));
    expect(audienceCounts(rec, opt, new Set(), { fields: neededFields(map) })).toMatchObject({ willReceive: 1, missingValue: 1 });
  });
});

describe('variables', () => {
  const tpl = { variables: { body: 2, url_buttons: [0] } };
  it('maps to Relay sources, static text, and a click-tracked button', () => {
    const v = relayVariables({ body: [{ source: 'contact.first_name' }, { source: 'static', text: '20 de octubre' }], button: { source: 'static', text: 'abc-123' } }, 'wc-promo-x1');
    expect(v).toEqual({ body: ['contact.first_name', 'static:20 de octubre'], buttons: [{ index: 0, source: 'static:abc-123?utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=wc-promo-x1' }] });
    expect(relayVariables({ body: [], button: { source: 'static', text: 'p?x=1', track: true } }, 's').buttons[0].source).toBe('static:p?x=1&utm_source=whatsapp&utm_medium=whatsapp&utm_campaign=s');
  });
  it('every variable must be filled', () => {
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }] })).toMatch(/Body \{\{2\}\}/);
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }, { source: 'static', text: ' ' }] })).toMatch(/text for Body \{\{2\}\}/);
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }, { source: 'contact.email' }] })).toMatch(/button/);
    expect(variablesProblem(tpl, { body: [{ source: 'contact.first_name' }, { source: 'contact.email' }], button: { source: 'contact.phone' } })).toBeNull();
  });
  it('preview fills the sample contact', () => {
    expect(previewText('Hola {{1}}, tu {{2}} y {{3}}', { body: [{ source: 'contact.first_name' }, { source: 'static', text: 'casa' }] })).toBe('Hola María, tu casa y {{3}}');
  });
  it('slug for utm_campaign', () => {
    expect(campaignSlug('Promo Octubre 2026 — Asunción', 'ab12')).toBe('wc-promo-octubre-2026-asuncion-ab12');
  });
});

describe('results', () => {
  const sentAt = '2026-10-20T22:42:43.000Z';
  const msgs = [
    { direction: 'inbound', kind: 'inbound', timestamps: { created: '2026-10-20T22:50:00Z' } },
    { direction: 'outbound', kind: 'campaign', template: { name: 'cl_cuenta_lista' }, status: 'read', timestamps: { created: '2026-10-20T22:42:43.836Z' } },
    { direction: 'outbound', kind: 'campaign', template: { name: 'cl_cuenta_lista' }, status: 'read', timestamps: { created: '2026-10-01T10:00:00Z' } },  // an older campaign
    { direction: 'outbound', kind: 'template', template: { name: 'cl_cuenta_lista' }, status: 'sent', timestamps: { created: '2026-10-20T22:45:00Z' } },  // an automation, not the campaign
  ];
  it('finds this campaign\'s message and a reply after it', () => {
    const m = matchCampaignMessage(msgs, { template: 'cl_cuenta_lista', sentAt });
    expect(m.message.timestamps.created).toBe('2026-10-20T22:42:43.836Z');
    expect(m.replied_at).toBe('2026-10-20T22:50:00.000Z');
    expect(matchCampaignMessage(msgs, { template: 'cl_visitas', sentAt })).toBeNull();
  });
  it('totals: waiting / skipped / sent / delivered / read / failed / replied / clicked', () => {
    const r = campaignResults([
      { status: 'read', meta: { replied_at: 'x' } }, { status: 'delivered' }, { status: 'sent' }, { status: 'failed' },
      { status: 'sending' }, { status: 'failed', meta: { skipped: 'no_opt_in' } },
    ], 1);
    expect(r).toMatchObject({ recipients: 6, waiting: 1, skipped: 1, sent: 4, delivered: 2, read: 1, failed: 1, replied: 1, clicked: 1, readRate: 50, replyRate: 50 });
  });
});
