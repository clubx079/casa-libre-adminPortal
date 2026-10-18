import { describe, it, expect } from 'vitest';
import { automationSlots, validateChannels } from '../lib/whatsappAdmin.js';

const emails = [
  { id: 'e1', name: 'Pagada — termina', key: 'paid-listing-ending' },
  { id: 'e2', name: 'Pagada — terminó', key: 'paid-listing-ended' },
  { id: 'e3', name: 'Plan agentes', key: 'agent-plan' },
];
const paid = { id: 'paid_listings', template_id: 'e1', reminder_template_id: 'e2', gift_template_id: 'e3' };
const relay = [
  { name: 'cl_publicacion_vence', status: 'APPROVED', category: 'utility' },
  { name: 'cl_publicacion_termino', status: 'PENDING', category: 'utility' },
  { name: 'cl_plan_agentes', status: 'APPROVED', category: 'marketing' },
];

describe('automationSlots', () => {
  it('lists each email of an automation with the template made for it', () => {
    const s = automationSlots(paid, emails);
    expect(s.map((x) => [x.what, x.templateId, x.suggested])).toEqual([
      ['Ends-soon email', 'e1', 'cl_publicacion_vence'],
      ['Ended email', 'e2', 'cl_publicacion_termino'],
      ['Plan for agents email', 'e3', 'cl_plan_agentes'],
    ]);
  });
  it('the same email in two slots shows once', () => {
    expect(automationSlots({ id: 'no_listing_nudge', template_id: 'x', reminder_template_id: 'x' }, [])).toHaveLength(1);
  });
});

describe('validateChannels', () => {
  const slots = automationSlots(paid, emails);
  it('email needs nothing else', () => {
    expect(validateChannels({ channel: 'email' }, { slots, relay })).toEqual({ ok: true, value: { channel: 'email', wa_templates: {} } });
  });
  it('WhatsApp needs at least one approved, supported template', () => {
    expect(validateChannels({ channel: 'whatsapp', wa_templates: {} }, { slots, relay }).error).toBe('pick_a_whatsapp_template');
    expect(validateChannels({ channel: 'whatsapp', wa_templates: { e2: 'cl_publicacion_termino' } }, { slots, relay }).error).toBe('whatsapp_template_not_approved');
    expect(validateChannels({ channel: 'both', wa_templates: { e1: 'nope' } }, { slots, relay }).error).toBe('unsupported_whatsapp_template');
    expect(validateChannels({ channel: 'both', wa_templates: { e1: 'cl_publicacion_vence', e3: 'cl_plan_agentes' } }, { slots, relay }))
      .toEqual({ ok: true, value: { channel: 'both', wa_templates: { e1: 'cl_publicacion_vence', e3: 'cl_plan_agentes' } } });
  });
  it('only where the template links work (Paraguay)', () => {
    expect(validateChannels({ channel: 'whatsapp', wa_templates: { e1: 'cl_publicacion_vence' } }, { slots, relay, country: 'bo' }).error).toBe('whatsapp_not_for_country');
  });
});
