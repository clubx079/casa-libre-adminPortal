// The Users page search: forgiving, as you type. Pure — test/userSearch.test.js.
//   • name / email: any part, any case, accents ignored ("maria" finds "María Benítez",
//     "beni" finds her too); several words can come in any order ("benitez maria")
//   • phone: any run of 3+ digits, typed however ("9233", "+92 336", "0981 555", "981-555")
//     against the profile phone and the phones on their listings; a leading 0 or the
//     country's calling code may be left out
// Every word typed must match somewhere (name, email or a phone).

export const fold = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const digitsOf = (s) => String(s || '').replace(/\D/g, '');

// "+595 981 555" → the digit strings to look for: as typed, without leading zeros and,
// when it starts with the calling code, without it.
export function digitVariants(term, prefix = '') {
  const d = digitsOf(term);
  if (d.length < 3) return [];
  const out = new Set([d]);
  const noZero = d.replace(/^0+/, '');
  if (noZero.length >= 3) out.add(noZero);
  if (prefix && noZero.startsWith(prefix) && noZero.length - prefix.length >= 3) out.add(noZero.slice(prefix.length).replace(/^0+/, ''));
  return [...out];
}

// The search → words. A phone typed with spaces ("0981 555 010") stays one word.
export function searchTerms(q) {
  const raw = String(q || '').trim();
  if (!raw) return [];
  if (/^[+\d\s().-]+$/.test(raw)) return [raw];   // only a phone number
  return fold(raw).split(/\s+/).filter(Boolean);
}

// user: { full_name, email, phone }, phones: other numbers of theirs (listing phones).
export function matchesUser(user, q, { phones = [], prefix = '' } = {}) {
  const terms = searchTerms(q);
  if (!terms.length) return true;
  const text = fold(`${user.full_name || ''} ${user.email || ''}`);
  const nums = [user.phone, ...phones].map(digitsOf).filter(Boolean);
  return terms.every((t) => {
    if (text.includes(fold(t).replace(/\s+/g, ' '))) return true;
    const variants = digitVariants(t, prefix);
    return variants.length > 0 && /^[+\d\s().-]+$/.test(t) && nums.some((n) => variants.some((v) => n.includes(v)));
  });
}
