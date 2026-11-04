// Relay webhook signature (Relay-Signature: t=<unix>,v1=<hex HMAC-SHA256 of `${t}.${rawBody}`>).
// Pure (no env), so it is unit-tested. Rejects timestamps older than 5 minutes.
import crypto from 'node:crypto';

export function verifyRelaySignature(rawBody, header, secret, toleranceSec = 300, nowSec = Date.now() / 1000) {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(String(header).split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(nowSec - t) > toleranceSec) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const got = Buffer.from(parts.v1 || '');
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(expected), got);
}
