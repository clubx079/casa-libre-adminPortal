import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import { verifyRelaySignature } from '../lib/relaySignature';

const sign = (body, secret, t) => `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('verifyRelaySignature (admin Relay webhook)', () => {
  const body = '{"type":"message.inbound"}', secret = 'whsec_test', now = 1_800_000_000;
  it('accepts a fresh, correctly signed body', () => {
    expect(verifyRelaySignature(body, sign(body, secret, now - 10), secret, 300, now)).toBe(true);
  });
  it('rejects a wrong secret, a changed body, an old timestamp and a missing header', () => {
    expect(verifyRelaySignature(body, sign(body, 'other', now), secret, 300, now)).toBe(false);
    expect(verifyRelaySignature(body + ' ', sign(body, secret, now), secret, 300, now)).toBe(false);
    expect(verifyRelaySignature(body, sign(body, secret, now - 1000), secret, 300, now)).toBe(false);
    expect(verifyRelaySignature(body, null, secret, 300, now)).toBe(false);
    expect(verifyRelaySignature(body, sign(body, secret, now), '', 300, now)).toBe(false);
  });
});
