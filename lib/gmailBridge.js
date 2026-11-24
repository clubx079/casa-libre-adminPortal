import 'server-only';
import crypto from 'crypto';

// The info@casa-libre.com Gmail bridge: a Google Apps Script web app running inside the
// info@ account (script: Desktop/airosofts/gmail-bridge.gs). The admin calls it with
// { secret, action, ... }; the script pushes new emails to /api/email-bridge every minute.
const url = () => process.env.GMAIL_BRIDGE_URL || '';
const secret = () => process.env.GMAIL_BRIDGE_SECRET || '';

export const bridgeReady = () => !!(url() && secret());

export async function bridge(action, payload = {}, { timeoutMs = 45000 } = {}) {
  if (!bridgeReady()) throw new Error('bridge_not_configured');
  // Apps Script answers POST with a 302 to googleusercontent.com; fetch follows it with a GET.
  const res = await fetch(url(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...payload, secret: secret(), action }),
    redirect: 'follow',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text();
  let d;
  try { d = JSON.parse(text); } catch { throw new Error(`bridge_bad_response_${res.status}`); }
  if (!d.ok) throw new Error(d.error || 'bridge_error');
  return d;
}

// The push from the script carries the same secret in X-Bridge-Secret.
export function bridgeSecretOk(given) {
  const s = secret();
  if (!s || !given) return false;
  const a = Buffer.from(String(given));
  const b = Buffer.from(s);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
