// info@ email sorting — pure pieces (no server-only, so the tests can import them).
// The AI puts every incoming email into one category; the category is saved on the Gmail
// thread as a label (AI-Enquiry, AI-Business, …), so Gmail itself is the store and the
// admin needs no table. AI-Alerted marks threads the team was already emailed about.

export const CATEGORIES = {
  enquiry: { label: 'AI-Enquiry', name: 'Enquiry', tone: 'success', important: true },
  business: { label: 'AI-Business', name: 'Business', tone: 'info', important: true },
  notification: { label: 'AI-Notification', name: 'Notification', tone: 'neutral', important: false },
  marketing: { label: 'AI-Marketing', name: 'Marketing', tone: 'warning', important: false },
  spam: { label: 'AI-Spam', name: 'Spam', tone: 'danger', important: false },
};
export const ALERTED_LABEL = 'AI-Alerted';
export const CATEGORY_KEYS = Object.keys(CATEGORIES);

// Gmail search: a label "AI-Enquiry" is searched as label:ai-enquiry
export const labelQuery = (key) => `label:${CATEGORIES[key].label.toLowerCase()}`;

// The thread's category from its Gmail labels (null = not sorted yet).
export function categoryFromLabels(labels = []) {
  for (const k of CATEGORY_KEYS) if (labels.includes(CATEGORIES[k].label)) return k;
  return null;
}
export const isAlerted = (labels = []) => labels.includes(ALERTED_LABEL);

// The views on the Email page → the Gmail search behind each.
export const VIEWS = {
  inbox: { name: 'Inbox', query: 'in:inbox' },
  important: { name: 'Important', query: `(${labelQuery('enquiry')} OR ${labelQuery('business')})` },
  unread: { name: 'Unread', query: 'in:inbox is:unread' },
  sent: { name: 'Sent', query: 'in:sent' },
  spam: { name: 'Spam', query: 'in:spam' },
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

export const SYSTEM_PROMPT = `You sort the emails that arrive at info@casa-libre.com, the main inbox of Casa-Libre, a real-estate marketplace in Paraguay, Uruguay, Bolivia, El Salvador and Venezuela (owners and agents list properties, buyers and renters contact them).
Categories:
- enquiry: a real person writing to Casa-Libre: about buying, renting or selling, a listing, their account, a problem, a complaint or a question.
- business: a company, agency or professional writing personally: partnership, advertising, a proposal, a legal or takedown request, press, an agency about its listings, a supplier offering a service.
- notification: automatic messages from services: verification codes, account or security notices, reviews, receipts, app store or Google / Facebook / OpenAI account emails.
- marketing: newsletters, promotions, product updates, mass mailings.
- spam: scams, phishing, junk.
Reply with JSON only, no other text: {"category":"enquiry|business|notification|marketing|spam","summary":"one short English sentence: who wants what","urgent":true|false}
urgent = it needs a reply within a day (a complaint, a legal or takedown request, a buyer or seller waiting, a business opportunity).`;

export function buildUserPrompt(msg) {
  const body = String(msg.text || '').replace(/\n{3,}/g, '\n\n').slice(0, 3500);
  return `From: ${msg.from || ''}\nTo: ${msg.to || ''}\nSubject: ${msg.subject || ''}\nDate: ${msg.date || ''}\n\n${body}`;
}

// Model output → { category, summary, urgent } (null when unreadable).
export function parseTriage(raw) {
  if (!raw) return null;
  const m = String(raw).match(/\{[\s\S]*\}/);
  if (!m) return null;
  let o;
  try { o = JSON.parse(m[0]); } catch { return null; }
  const category = String(o.category || '').toLowerCase().trim();
  if (!CATEGORIES[category]) return null;
  return { category, summary: String(o.summary || '').trim().slice(0, 300), urgent: o.urgent === true || o.urgent === 'true' };
}

// Should this pushed email raise an alert? Only fresh, incoming, important ones (an old
// email from the first 30-day import never alerts).
export function shouldAlert({ msg, triage, labels = [], now = Date.now(), freshMs = 6 * 3600 * 1000 }) {
  if (!msg || msg.sentByUs || !triage) return false;
  if (!CATEGORIES[triage.category]?.important) return false;
  if (isAlerted(labels)) return false;
  const t = new Date(msg.date).getTime();
  return Number.isFinite(t) && now - t <= freshMs;
}

// "Name <a@b.com>" → { name, email }
export function parseAddress(s) {
  const str = String(s || '').trim();
  const m = str.match(/^(.*?)\s*<([^>]+)>$/);
  if (m) return { name: m[1].replace(/^"|"$/g, '').trim() || m[2], email: m[2].trim() };
  return { name: str, email: str };
}
