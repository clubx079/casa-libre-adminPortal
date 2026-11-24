// info@ email sorting — pure pieces (no server-only, so the tests can import them).
// The AI puts every incoming email into one of four types; the type is saved on the Gmail thread
// as a label (AI-Important, AI-Marketing, AI-Other, AI-Spam), so Gmail itself is the store.
// AI-Alerted marks threads that were already forwarded to the team (each email goes out once).

export const CATEGORIES = {
  important: { label: 'AI-Important', name: 'Important', tone: 'success', help: 'Real enquiries from real people: buyers, owners, agents and agencies writing about Casa-Libre.' },
  marketing: { label: 'AI-Marketing', name: 'Marketing', tone: 'warning', help: 'Other businesses pitching us: services, partnerships, advertising, newsletters, promotions.' },
  other: { label: 'AI-Other', name: 'Other', tone: 'neutral', help: 'Automatic and random emails: codes, account notices, Google reviews, receipts.' },
  spam: { label: 'AI-Spam', name: 'Spam', tone: 'danger', help: 'Scams, phishing and junk.' },
};
export const CATEGORY_KEYS = Object.keys(CATEGORIES);
export const ALERTED_LABEL = 'AI-Alerted';
// labels from the first version (Nov 24) — read as the new types; AI-Business is sorted again
const LEGACY = { 'AI-Enquiry': 'important', 'AI-Notification': 'other' };

// Gmail search: a label "AI-Important" is searched as label:ai-important
const lq = (label) => `label:${label.toLowerCase()}`;
export const labelQuery = (key) => lq(CATEGORIES[key].label);

// The thread's type from its Gmail labels (null = not sorted yet).
export function categoryFromLabels(labels = []) {
  for (const k of CATEGORY_KEYS) if (labels.includes(CATEGORIES[k].label)) return k;
  for (const [l, k] of Object.entries(LEGACY)) if (labels.includes(l)) return k;
  return null;
}
export const isAlerted = (labels = []) => labels.includes(ALERTED_LABEL);

// The tabs on the Email page → the Gmail search behind each.
export const VIEWS = {
  inbox: { name: 'Inbox', query: 'in:inbox' },
  important: { name: 'Important', query: `(${labelQuery('important')} OR ${lq('AI-Enquiry')})` },
  marketing: { name: 'Marketing', query: labelQuery('marketing') },
  other: { name: 'Other', query: `(${labelQuery('other')} OR ${lq('AI-Notification')})` },
  unread: { name: 'Unread', query: 'in:inbox is:unread' },
  sent: { name: 'Sent', query: 'in:sent' },
  spam: { name: 'Spam', query: `(in:spam OR ${labelQuery('spam')})` },
  all: { name: 'All mail', query: '-in:drafts' },
};

export function viewQuery(view, { search = '', hideJunk = false } = {}) {
  const v = VIEWS[view] || VIEWS.inbox;
  const parts = [v.query];
  if (hideJunk && (view === 'inbox' || view === 'unread')) parts.push(`-${labelQuery('marketing')}`, `-${labelQuery('spam')}`);
  const s = String(search || '').trim();
  if (s) parts.push(s);
  return parts.join(' ');
}

export const SYSTEM_PROMPT = `You sort the emails that arrive at info@casa-libre.com, the main inbox of Casa-Libre, a real-estate marketplace in Paraguay, Uruguay, Bolivia, El Salvador and Venezuela (owners and agents list properties for free, buyers and renters contact them).
Types:
- important: a REAL person, agency or company writing to Casa-Libre as a user or possible user/partner, about OUR service. Examples: asking the conditions, terms or price of our partner program, advertising with us or listing with us; replying "we are interested" to a proposal we sent; a buyer or renter asking about a property; an owner or agent who wants to list or asks the price; a question or problem with their account, listing or payment; a complaint; an agency or owner asking to remove, fix or update their listings (including legal or takedown requests); a reply from a user we wrote to.
- marketing: anyone trying to sell US their own product or service (they are the seller and we would be the buyer). Examples: a company offering its services (cleaning, SEO, apps, design, ads, leads), partnership or advertising pitches, cold outreach, sales follow-ups, newsletters, promotions, product updates.
- other: automatic or random emails. Examples: verification codes, account or security notices, Google Business reviews, receipts and invoices, app store or platform notices, delivery reports, and anything that is none of the other types.
- spam: scams, phishing, junk.
If a business offers us a service, it is marketing, even when it is polite and personal. Important is only for real enquiries about Casa-Libre.
But when a person or company asks about OUR service (how Casa-Libre works, prices, listing their properties, advertising with us, our partner or referral program), or answers an email we sent them with interest or questions, it is important, even if they first wrote to sell us something.
Reply with JSON only, no other text: {"category":"important|marketing|other|spam","summary":"one short English sentence: who wants what","urgent":true|false}
urgent = an important email that needs a reply within a day (a complaint, a legal or takedown request, a buyer or seller waiting).`;

// A reply's own words only: cut the quoted older emails ("El lun, 23 nov … escribió:", "On … wrote:",
// "-----Original Message-----", "De: … / Enviado: …", lines starting with ">"), so the AI sorts what
// the person wrote NOW, not the first email of the conversation.
const QUOTE_START = [
  /^\s*>/,
  /^\s*(El|On|Le|Am)\s.+(escribi[oó]|wrote|a écrit|schrieb)\s*:?\s*$/i,
  /^\s*-{2,}\s*(Original Message|Mensaje original|Forwarded message|Mensaje reenviado)/i,
];
export function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const header = /^\s*(De|From)\s*:/i.test(l) && /^\s*(Enviado|Sent|Date|Fecha)\s*:/i.test(lines[i + 1] || '');
    if (header || QUOTE_START.some((re) => re.test(l))) { cut = i; break; }
  }
  const own = (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim();
  return own || String(text || '').trim();
}

export function buildUserPrompt(msg) {
  const body = stripQuoted(msg.text).replace(/\n{3,}/g, '\n\n').slice(0, 3500);
  return `From: ${msg.from || ''}\nTo: ${msg.to || ''}\nSubject: ${msg.subject || ''}\nDate: ${msg.date || ''}\n\n${body}`;
}

// Model output → { category, summary, urgent } (null when unreadable).
export function parseTriage(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  let category = String(o.category || '').toLowerCase().trim();
  if (category === 'enquiry') category = 'important';
  if (category === 'notification') category = 'other';
  if (!CATEGORIES[category]) return null;
  return { category, summary: String(o.summary || '').trim().slice(0, 300), urgent: category === 'important' && (o.urgent === true || o.urgent === 'true') };
}

// ── forwarding settings: [{ email, categories: ['important', …] }] ──
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
export function normalizeRules(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const seen = new Map();
  for (const r of list) {
    const email = String(r?.email || '').trim().toLowerCase();
    if (!EMAIL_RE.test(email)) continue;
    const cats = [...new Set((Array.isArray(r?.categories) ? r.categories : []).map(String).filter((c) => CATEGORIES[c]))];
    const prev = seen.get(email);
    seen.set(email, prev ? [...new Set([...prev, ...cats])] : cats);
  }
  return [...seen.entries()].slice(0, 25).map(([email, categories]) => ({ email, categories: CATEGORY_KEYS.filter((c) => categories.includes(c)) }));
}
export function invalidEmails(raw) {
  return (Array.isArray(raw) ? raw : []).map((r) => String(r?.email || '').trim()).filter((e) => e && !EMAIL_RE.test(e.toLowerCase()));
}

// Before anything is saved: the env list (EMAIL_ALERT_TO) gets the important emails.
export const defaultRules = (envList = '') => normalizeRules(String(envList).split(',').map((email) => ({ email, categories: ['important'] })));

export const recipientsFor = (category, rules = []) => rules.filter((r) => r.categories.includes(category)).map((r) => r.email);

// Should this pushed email be forwarded, and to whom? Only fresh, incoming, not-yet-forwarded
// emails (an old email from the first 30-day import is never forwarded).
export function forwardTargets({ msg, triage, labels = [], rules = [], now = Date.now(), freshMs = 6 * 3600 * 1000 }) {
  if (!msg || msg.sentByUs || !triage) return [];
  if (isAlerted(labels)) return [];
  const t = new Date(msg.date).getTime();
  if (!Number.isFinite(t) || now - t > freshMs) return [];
  return recipientsFor(triage.category, rules);
}

// A conversation's type after a new incoming email was sorted: an unsorted one takes the new
// type; a real enquiry anywhere in it makes it Important (e.g. a company that first pitched us and
// then asks about our partner program); otherwise it keeps its type (never moved down).
export function nextCategory(current, incoming) {
  if (!incoming) return current || null;
  if (!current) return incoming;
  if (incoming === 'important' && current !== 'important') return 'important';
  return current;
}

// "Name <a@b.com>" → { name, email }
export function parseAddress(s) {
  const str = String(s || '').trim();
  const m = str.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || m[2], email: m[2].trim() };
  return { name: str, email: str };
}

// ── sidebar badge: which types count in the unread number next to "Email (info@)" ──
export const DEFAULT_BADGE = ['important'];
export function normalizeBadge(raw) {
  if (!Array.isArray(raw)) return [...DEFAULT_BADGE];
  return CATEGORY_KEYS.filter((k) => raw.map(String).includes(k));
}
// PostgREST filter for the unread conversations of these types (null = count nothing)
export function badgeFilter(types = []) {
  const t = normalizeBadge(types);
  if (!t.length) return null;
  return `unread=eq.true&in_trash=eq.false&category=in.(${t.join(',')})${t.includes('spam') ? '' : '&in_spam=eq.false'}`;
}
