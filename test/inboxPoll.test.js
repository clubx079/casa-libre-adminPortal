import { describe, it, expect } from 'vitest';
import { recentConversations, newestInbound } from '../lib/inboxPollCore.js';

const now = Date.parse('2026-11-04T20:00:00Z');
const min = (n) => new Date(now - n * 60000).toISOString();

describe('inbox poller', () => {
  it('looks only at conversations with a customer message in the last 15 minutes', () => {
    const list = [
      { phone: '595981111111', last_inbound_at: min(2) },
      { phone: '595981222222', last_inbound_at: min(40) },
      { phone: '595981333333', last_inbound_at: null },
      { phone: '', last_inbound_at: min(1) },
    ];
    expect(recentConversations(list, { now }).map((c) => c.phone)).toEqual(['595981111111']);
  });

  it('hands over the newest inbound message, shaped like the webhook event', () => {
    const conv = { phone: '+595 981 111111' };
    const msgs = [
      { id: 'out1', direction: 'outbound', text: 'hola', timestamps: { created: min(1) } },
      { id: 'in2', direction: 'inbound', type: 'text', text: '¿cuánto cuesta?', timestamps: { created: min(3) } },
      { id: 'in1', direction: 'inbound', type: 'text', text: 'hola', timestamps: { created: min(5) } },
    ];
    const e = newestInbound(conv, msgs, new Set(), { now });
    expect(e).toMatchObject({ id: 'in2', from: '+595981111111', phone: '595981111111', text: '¿cuánto cuesta?' });
  });

  it('never hands over the same message twice, nor an old one', () => {
    const conv = { phone: '595981111111' };
    const msgs = [{ id: 'in1', direction: 'inbound', text: 'hola', timestamps: { created: min(3) } }];
    expect(newestInbound(conv, msgs, new Set(['in1']), { now })).toBeNull();
    expect(newestInbound(conv, [{ id: 'old', direction: 'inbound', text: 'x', timestamps: { created: min(30) } }], new Set(), { now })).toBeNull();
    expect(newestInbound(conv, [], new Set(), { now })).toBeNull();
  });
});
