// DEV-ONLY workaround for a machine whose DNS fails for some Google API hosts (seen locally with
// googleads.googleapis.com). Off unless GOOGLE_DNS_FALLBACK=1; production never sets it.
//   GOOGLE_DNS_FALLBACK=1
//   GOOGLE_DNS_FALLBACK_HOSTS=googleads.googleapis.com=142.250.0.95,searchconsole.googleapis.com=…
// (an IP from `nslookup <host> 8.8.8.8`). The request goes to that IP with the hostname kept for TLS
// SNI and certificate checks (Node https `lookup` option), so nothing else changes.
// googleFetch(url, init) → a fetch-like Response ({ ok, status, json(), text() }).
import https from 'node:https';

function fallbackIp(host) {
  if (process.env.GOOGLE_DNS_FALLBACK !== '1') return null;
  for (const pair of String(process.env.GOOGLE_DNS_FALLBACK_HOSTS || '').split(',')) {
    const [h, ip] = pair.split('=').map((s) => s && s.trim());
    if (h && ip && h.toLowerCase() === host.toLowerCase()) return ip;
  }
  return null;
}

export function googleFetch(url, init = {}) {
  const u = new URL(url);
  const ip = fallbackIp(u.hostname);
  if (!ip) return fetch(url, init);
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname, servername: u.hostname, port: 443, path: u.pathname + u.search, method: init.method || 'GET',
      headers: init.headers || {},
      lookup: (hostname, opts, cb) => (opts && opts.all ? cb(null, [{ address: ip, family: 4 }]) : cb(null, ip, 4)),
      timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, headers: res.headers, text: async () => text, json: async () => JSON.parse(text) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    if (init.body) req.write(init.body);
    req.end();
  });
}
