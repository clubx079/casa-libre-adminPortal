import { describe, it, expect } from 'vitest';
import { abandonedCheckouts, checkoutLabel } from '../lib/checkouts.js';

describe('abandoned checkouts', () => {
  it('started with no success for the same PaymentIntent after an hour', () => {
    const now = Date.parse('2026-10-26T12:00:00Z');
    const rows = [
      { status: 'started', stripe_payment_intent_id: 'a', created_at: '2026-10-26T08:00:00Z' },
      { status: 'succeeded', stripe_payment_intent_id: 'a', created_at: '2026-10-26T08:01:00Z' },
      { status: 'started', stripe_payment_intent_id: 'b', created_at: '2026-10-26T09:00:00Z' },
      { status: 'started', stripe_payment_intent_id: 'c', created_at: '2026-10-26T11:30:00Z' },
    ];
    const { started, abandoned } = abandonedCheckouts(rows, { now });
    expect(started).toHaveLength(3);
    expect(abandoned.map((x) => x.stripe_payment_intent_id)).toEqual(['b']);
    expect(checkoutLabel('highlight', 'home')).toBe('Home page promotion');
    expect(checkoutLabel('listing')).toBe('Extra listing');
  });
});
