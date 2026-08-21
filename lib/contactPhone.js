// Shared contact-phone extraction + normalization for scrapers and backfill.
//
// Every Paraguay real-estate source publishes the agent's phone, but in a
// different place: schema.org JSON-LD (tulugar), schema.org microdata
// (remax), a `property_contact` block with tel:/telf:/wa.me links (Sotheby's
// via Raíces), or a whatsapp deep-link. This module knows all of those shapes
// so an adapter never has to reinvent the parsing, and normalizes every result
// to the canonical `595XXXXXXXXX` form the buyer portal's normalizePy expects.
//
// Kept dependency-free (plain string parsing + global fetch) so the standalone
// backfill script can import it without Next path aliases or `server-only`.

// Normalize any Paraguay phone string to canonical wa.me digits: 595 + number,
// no plus, no leading zero. Returns '' when the input can't be a real PY phone.
export function normalizePyPhone(raw) {
  let d = String(raw ?? '').replace(/\D/g, '');
  if (!d) return '';
  // Some sources prefix the intl access code (00595...) — drop it.
  if (d.startsWith('00595')) d = d.slice(2);
  if (d.startsWith('595')) {
    // already country-coded
  } else if (d.startsWith('0')) {
    d = '595' + d.slice(1); // local trunk 0 -> country code
  } else {
    d = '595' + d;
  }
  // PY: 595 + (8..10 digits). Mobiles are 595 + 9 (start 9). Reject junk.
  if (d.length < 11 || d.length > 13) return '';
  const local = d.slice(3);
  if (/^(\d)\1+$/.test(local)) return ''; // 595999999999 etc.
  return d;
}

const uniqNorm = (arr) => {
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const n = normalizePyPhone(v);
    if (n && !seen.has(n)) { seen.add(n); out.push(n); }
  }
  return out;
};

// --- schema.org JSON-LD: RealEstateAgent / Person / provider.telephone ---
export function fromJsonLd(html) {
  const blocks = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  for (const block of blocks) {
    const json = block.replace(/^<script[^>]*>/i, '').replace(/<\/script>$/i, '').trim();
    let phone = null;
    let name = null;
    // Robust to arrays/graphs: scan the raw JSON text for an agent+telephone pair.
    const agentM = json.match(/"@type"\s*:\s*"(?:RealEstateAgent|Person|Organization)"[\s\S]*?"telephone"\s*:\s*"([^"]+)"/i);
    if (agentM) phone = agentM[1];
    if (!phone) {
      const provM = json.match(/"provider"\s*:\s*\{[\s\S]*?"telephone"\s*:\s*"([^"]+)"/i);
      if (provM) phone = provM[1];
    }
    if (phone) {
      const nameM =
        json.match(/"@type"\s*:\s*"(?:RealEstateAgent|Person)"[\s\S]*?"name"\s*:\s*"([^"]+)"/i) ||
        json.match(/"provider"\s*:\s*\{[\s\S]*?"name"\s*:\s*"([^"]+)"/i);
      if (nameM) name = nameM[1].trim();
      const n = normalizePyPhone(phone);
      if (n) return { phone: n, name: name || null };
    }
  }
  return null;
}

// --- schema.org microdata: <span itemprop="telephone">+595...</span> ---
export function fromMicrodata(html) {
  const phones = [...html.matchAll(/itemprop=["']telephone["'][^>]*>\s*([+\d][\d\s().-]{6,})</gi)].map((m) => m[1]);
  const names = [...html.matchAll(/itemprop=["']name["'][^>]*>\s*([^<]{2,80})</gi)].map((m) => m[1].trim());
  const norm = uniqNorm(phones);
  if (norm.length) return { phone: norm[0], name: names[0] || null };
  return null;
}

// --- whatsapp deep-links: wa.me/595... or ...?phone=595... ---
export function fromWhatsApp(html, { exclude } = {}) {
  const raw = [
    ...[...html.matchAll(/wa\.me\/(\+?\d{7,15})/gi)].map((m) => m[1]),
    ...[...html.matchAll(/[?&]phone=(\+?\d{7,15})/gi)].map((m) => m[1]),
  ];
  const ex = new Set(exclude || []);
  const norm = uniqNorm(raw).filter((n) => !ex.has(n));
  return norm.length ? { phone: norm[0], name: null } : null;
}

// --- tel:/telf: links or a phoneLink anchor (Raíces/Sotheby's) ---
export function fromTelLinks(html, { exclude } = {}) {
  const raw = [
    ...[...html.matchAll(/(?:href=["']tel[fp]?:|class=["']phoneLink["'][^>]*>)\s*(\+?[\d\s().-]{7,})/gi)].map((m) => m[1]),
  ];
  const ex = new Set(exclude || []);
  const norm = uniqNorm(raw).filter((n) => !ex.has(n));
  return norm.length ? { phone: norm[0], name: null } : null;
}

// Try every strategy in priority order. `scope` (optional) limits parsing to a
// substring (e.g. an agent-card section) so shared office numbers elsewhere on
// the page are ignored. `exclude` is a list of raw/normalized numbers to skip.
export function extractContact(html, { scope, exclude } = {}) {
  const src = scope || html;
  const ex = (exclude || []).map(normalizePyPhone).filter(Boolean);
  return (
    fromJsonLd(src) ||
    fromMicrodata(src) ||
    fromTelLinks(src, { exclude: ex }) ||
    fromWhatsApp(src, { exclude: ex }) ||
    null
  );
}

// Convenience: fetch a detail page and extract {name, phone}. Never throws.
export async function fetchContact(url, opts = {}) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': opts.ua || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36', Accept: 'text/html' },
      redirect: 'follow',
      signal: AbortSignal.timeout(opts.timeout || 20000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    return extractContact(html, opts);
  } catch {
    return null;
  }
}
