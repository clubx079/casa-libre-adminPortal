// Which admin pages a team member may open (Team → Page access). Pure, shared by the sidebar,
// the Team screen, the middleware gate and the server — test/adminPages.test.js.
//
// A member's access is stored on their control-DB row (admin_users.page_access, jsonb):
//   null                                  every page (Super Admins, and every member before roles existed)
//   { preset: 'marketing' }               a ready-made role: its pages come from ROLE_PRESETS below,
//                                         so changing a preset here updates everyone who has it
//   { preset: 'custom', pages: [keys] }   pages picked one by one
// Super Admins always have every page; page access only narrows an Admin.

export const PAGES = [
  { key: 'overview', href: '/', label: 'Overview', group: 'General' },
  { key: 'users', href: '/users', label: 'Users', group: 'People' },
  { key: 'leads', href: '/leads', label: 'Leads', group: 'People' },
  { key: 'partners', href: '/partners', label: 'Partners', group: 'People' },
  { key: 'inbox', href: '/inbox', label: 'Inbox', group: 'Messages' },
  { key: 'alerts', href: '/alerts', label: 'Alerts', group: 'Messages' },
  { key: 'campaigns', href: '/campaigns', label: 'WhatsApp Marketing', group: 'Marketing' },
  { key: 'automations', href: '/automations', label: 'Automations', group: 'Marketing' },
  { key: 'email-templates', href: '/email-templates', label: 'Templates', group: 'Marketing' },
  { key: 'referrals', href: '/referrals', label: 'Referrals', group: 'Marketing' },
  { key: 'utm-links', href: '/utm-links', label: 'UTM Links', group: 'Marketing' },
  { key: 'analytics', href: '/analytics', label: 'Analytics', group: 'Marketing' },
  { key: 'funnels', href: '/funnels', label: 'Funnels', group: 'Marketing' },
  { key: 'search-console', href: '/search-console', label: 'Search Console', group: 'Marketing' },
  { key: 'marketing', href: '/marketing', label: 'Marketing (Google Ads)', group: 'Marketing' },
  { key: 'properties', href: '/properties', label: 'Properties', group: 'Listings' },
  { key: 'quarantine', href: '/quarantine', label: 'Quarantine', group: 'Listings' },
  { key: 'reports', href: '/reports', label: 'Reports', group: 'Listings' },
  { key: 'feedbacks', href: '/feedbacks', label: 'Feedback', group: 'Listings' },
  { key: 'paid-listings', href: '/paid-listings', label: 'Paid listings', group: 'Money' },
  { key: 'earnings', href: '/earnings', label: 'Earnings', group: 'Money' },
  { key: 'manager', href: '/manager', label: 'Admin Manager', group: 'Team tools' },
  { key: 'ai-usage', href: '/ai-usage', label: 'AI usage', group: 'Team tools' },
  { key: 'scrape', href: '/scrape', label: 'Scrapers', group: 'Team tools' },
  { key: 'scraper-status', href: '/scraper-status', label: 'Scraper Status', group: 'Team tools' },
  { key: 'runs', href: '/runs', label: 'Runs', group: 'Team tools' },
  { key: 'app-updates', href: '/app-updates', label: 'App updates', group: 'App' },
  { key: 'app-installs', href: '/app-installs', label: 'App installs', group: 'App' },
];
export const PAGE_KEYS = PAGES.map((p) => p.key);
export const PAGE_GROUPS = [...new Set(PAGES.map((p) => p.group))];
const BY_KEY = new Map(PAGES.map((p) => [p.key, p]));
export const pageLabel = (key) => BY_KEY.get(key)?.label || key;

// Ready-made roles (Roland, Nov 11: a social media / marketing manager and a sales agent get only
// the marketing funnels, WhatsApp and email marketing, the inbox, the alerts and the leads — no
// Google Ads, no money). 'full' = every page.
export const ROLE_PRESETS = {
  full: {
    label: 'Full access',
    description: 'Every page of the admin.',
    pages: null,
  },
  marketing: {
    label: 'Social media / Marketing manager',
    description: 'Runs WhatsApp and email marketing, answers the inbox and watches the funnels. No Google Ads, no money pages.',
    pages: ['overview', 'inbox', 'alerts', 'campaigns', 'automations', 'email-templates', 'referrals', 'utm-links', 'analytics', 'funnels', 'search-console', 'leads'],
  },
  sales: {
    label: 'Sales agent',
    description: 'Talks to agencies and owners: the inbox, leads, WhatsApp marketing, users and their listings.',
    pages: ['overview', 'inbox', 'alerts', 'leads', 'funnels', 'campaigns', 'users', 'properties', 'partners'],
  },
};
export const PRESET_KEYS = Object.keys(ROLE_PRESETS);

// Anything stored → a clean access value (null = every page). Unknown page keys are dropped;
// an empty custom list stays empty (that member only has their Account page).
export function normalizeAccess(raw) {
  if (raw == null || raw === '') return null;
  let a = raw;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch { return null; } }
  if (!a || typeof a !== 'object') return null;
  const preset = String(a.preset || '').toLowerCase();
  if (preset === 'full') return null;
  if (preset && preset !== 'custom' && ROLE_PRESETS[preset]) return { preset };
  const pages = [...new Set((Array.isArray(a.pages) ? a.pages : []).map((k) => String(k)).filter((k) => BY_KEY.has(k)))];
  return { preset: 'custom', pages: PAGE_KEYS.filter((k) => pages.includes(k)) };
}

// → array of page keys, or null for every page.
export function allowedPages(access) {
  const a = normalizeAccess(access);
  if (!a) return null;
  if (a.preset !== 'custom') return [...ROLE_PRESETS[a.preset].pages];
  return a.pages;
}

// What the Team table shows: "Full access", "Sales agent", or "Custom · 4 pages".
export function accessLabel(access) {
  const a = normalizeAccess(access);
  if (!a) return ROLE_PRESETS.full.label;
  if (a.preset !== 'custom') return ROLE_PRESETS[a.preset].label;
  return `Custom · ${a.pages.length} ${a.pages.length === 1 ? 'page' : 'pages'}`;
}

// The session's access: Super Admins (and the env emergency account) see everything.
export const sessionPages = (session) => (!session || session.role === 'superadmin' ? null : allowedPages(session.access));

// ── paths ─────────────────────────────────────────────────────────────────────────────────────
// Always open to any signed-in admin: their own Account page, sign-out, the country switcher, the
// sidebar badges, the English preview helper and the image proxy.
const ALWAYS_PAGES = ['/team', '/aceptar-invitacion', '/recuperar-clave', '/restablecer-clave', '/login', '/preview'];
const ALWAYS_API = ['/api/auth', '/api/country', '/api/unread', '/api/translate-preview', '/api/media', '/api/team', '/api/cron', '/api/relay'];
// Old addresses that redirect into a page.
const PAGE_ALIASES = { '/contacts': 'utm-links' };

// Every API folder → the pages whose screens call it (an API is open when ANY of them is).
// test/adminPages.test.js fails when an app/api folder is missing here, so a new API can't
// silently become reachable (or unreachable) for a restricted role.
export const API_PAGES = {
  'ai-usage': ['ai-usage'],
  'search-console': ['search-console'],
  alerts: ['alerts'],
  analytics: ['analytics', 'utm-links'],
  'app-installs': ['app-installs', 'analytics'],
  'app-updates': ['app-updates'],
  automations: ['automations'],
  campaigns: ['campaigns'],
  contacts: ['utm-links'],
  earnings: ['earnings'],
  'email-results': ['utm-links'],
  'email-templates': ['email-templates', 'automations', 'campaigns'],
  feedbacks: ['feedbacks'],
  // /api/funnels/analytics also feeds the "Funnel sites" card on Analytics
  funnels: ['funnels', 'analytics'],
  google: ['marketing'],
  inbox: ['inbox', 'manager'],
  infocasas: ['scrape'],
  issues: ['manager'],
  leads: ['leads'],
  manager: ['manager'],
  marketing: ['marketing'],
  'paid-listings': ['paid-listings'],
  partners: ['partners'],
  properties: ['properties'],
  quarantine: ['quarantine'],
  referrals: ['referrals'],
  reports: ['reports'],
  scrape: ['scrape'],
  'scraper-registry': ['scraper-status', 'scrape'],
  sources: ['scrape'],
  users: ['users', 'analytics'],
  whatsapp: ['automations', 'campaigns'],
};

const starts = (path, base) => path === base || path.startsWith(`${base}/`);

// Which page a dashboard path belongs to ('/properties?kind=…' → 'properties'). null = not a page.
export function pageKeyForPath(pathname) {
  const p = String(pathname || '/').split('?')[0].replace(/\/+$/, '') || '/';
  if (p === '/') return 'overview';
  for (const [alias, key] of Object.entries(PAGE_ALIASES)) if (starts(p, alias)) return key;
  const hit = PAGES.filter((x) => x.href !== '/' && starts(p, x.href)).sort((a, b) => b.href.length - a.href.length)[0];
  return hit ? hit.key : null;
}

// May this session open this path? → true / false. Super Admins and full-access members: always.
export function canOpenPath(session, pathname) {
  const pages = sessionPages(session);
  if (!pages) return true;
  const p = String(pathname || '/').split('?')[0];
  if (p.startsWith('/api/')) {
    if (ALWAYS_API.some((b) => starts(p, b))) return true;
    const folder = p.split('/')[2] || '';
    const owners = API_PAGES[folder];
    return !!owners && owners.some((k) => pages.includes(k));   // an unknown API is closed to restricted roles
  }
  if (ALWAYS_PAGES.some((b) => starts(p, b))) return true;
  const key = pageKeyForPath(p);
  if (!key) return true;   // not a dashboard page (static files, Next internals)
  return pages.includes(key);
}

// Where to send someone who opened a page they can't see: their first allowed page, else Account.
export function homeFor(session) {
  const pages = sessionPages(session);
  if (!pages) return '/';
  const first = PAGES.find((x) => pages.includes(x.key));
  return first ? first.href : '/team';
}
