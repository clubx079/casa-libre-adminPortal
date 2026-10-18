// The WhatsApp inbox (admin → Inbox) talks to Relay's inbox API on the server — the
// browser never sees a key. Same conversations as Relay's own inbox, both ways in sync.
//   live → RELAY_API_KEY (the real number)   test → RELAY_TEST_API_KEY (simulated traffic)
// Docs: relay.airosofts.com/p/casa-libre/developers/docs ("Guide: build an inbox").
import 'server-only';

const base = () => String(process.env.RELAY_BASE_URL || 'https://relay.airosofts.com/v1').replace(/\/+$/, '');
const keyFor = (mode) => String((mode === 'test' ? process.env.RELAY_TEST_API_KEY : process.env.RELAY_API_KEY) || '').trim();
export const inboxModes = () => ({ live: !!keyFor('live'), test: !!keyFor('test') });
export const modeOf = (v) => (v === 'test' ? 'test' : 'live');
// "+595 981…" / "595981…" → "595981…" (Relay accepts the number without + in URLs)
export const phoneParam = (p) => encodeURIComponent(String(p || '').replace(/[^\d]/g, ''));

export async function relay(mode, path, { method = 'GET', json, body, headers = {}, raw = false } = {}) {
  const key = keyFor(mode);
  if (!key) return { ok: false, status: 503, data: { error: { code: 'not_configured', message: mode === 'test' ? 'RELAY_TEST_API_KEY is not set.' : 'RELAY_API_KEY is not set.' } } };
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : body,
    cache: 'no-store',
    signal: AbortSignal.timeout(20000),
  });
  if (raw) return r;
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}
