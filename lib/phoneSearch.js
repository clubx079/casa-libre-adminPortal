// Find people by phone however it was typed or stored: "0981 123 456", "+595 981 123456",
// "981123456" all find "+595981123456" (and a listing phone saved as "0981-123-456").
// The search keeps the digits, drops leading zeros and, when it starts with the country's
// calling code, also tries the number without it. Pure — test/phoneSearch.test.js.

export const digits = (s) => String(s || '').replace(/\D/g, '');

// The digit strings to look for (each ≥ 4 digits), or [] when the search isn't a phone.
export function phoneCores(q, prefix = '') {
  const raw = String(q || '').trim();
  if (!/^[+\d\s().-]+$/.test(raw)) return [];   // letters → a name / email search
  const d = digits(raw).replace(/^0+/, '');
  if (d.length < 4) return [];
  const out = new Set([d]);
  if (prefix && d.startsWith(prefix) && d.length - prefix.length >= 4) out.add(d.slice(prefix.length).replace(/^0+/, ''));
  return [...out];
}

export const phoneMatches = (stored, cores = []) => { const d = digits(stored); return !!d && cores.some((c) => d.includes(c)); };
