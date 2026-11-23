// Bots page (Team tools → Bots): the Grok bots that collect outside data for Claude.
// FRONT END ONLY for now: no bot is connected yet, nothing runs, and the settings are kept in the
// browser (localStorage) until the bots are wired to the admin. Each bot will later report every run
// here (what it did, what it found, what it cost) so the team can check it — Grok collects, Claude
// analyses, a person approves anything that leaves the building. Pure — test/grokBots.test.js.

export const COUNTRIES = [
  { value: 'py', label: 'Paraguay' }, { value: 'bo', label: 'Bolivia' }, { value: 'uy', label: 'Uruguay' },
  { value: 've', label: 'Venezuela' }, { value: 'sv', label: 'El Salvador' }, { value: 'br', label: 'Brazil' },
];
const CC5 = COUNTRIES.filter((c) => c.value !== 'br');
const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => ({ value: d.toLowerCase(), label: d }));

export const PRODUCT = {
  bot: { label: 'Grok Bot', hint: 'Runs on our Grok Pro account: cloud browser with its own logins, X and web search, on a schedule' },
};

// Settings every bot has.
export const COMMON_FIELDS = [
  { key: 'enabled', type: 'toggle', label: 'Bot switched on', help: 'Stays off until the bot is connected.' },
  { key: 'frequency', type: 'select', label: 'How often', options: [{ value: 'daily', label: 'Every day' }, { value: 'weekly', label: 'Once a week' }] },
  { key: 'day', type: 'select', label: 'Day', options: DAYS, showIf: (s) => s.frequency === 'weekly' },
  { key: 'time', type: 'time', label: 'Time (Paraguay)' },
  { key: 'monthlyCap', type: 'number', label: 'Monthly spend limit (US$)', min: 0, max: 500, help: 'The bot stops for the month when it reaches this.' },
  { key: 'notifyOnFailure', type: 'toggle', label: 'Alert the team when a run fails' },
];

export const BOTS = [
  {
    key: 'lead-finder',
    name: 'Agency lead finder',
    product: 'bot',
    summary: 'Finds agents, agencies and developers in directories, agency websites and public Facebook and Instagram pages, and builds a list for us to review.',
    chain: ['Grok Bot visits directories and pages', 'Claude removes duplicates and wrong numbers', 'A person approves the list'],
    output: 'A staging list in Leads: name, company, city, phone, source link.',
    rules: ['Never sends a message to anyone.', 'Skips contacts we already have in Leads.', 'Reads public pages only.'],
    defaults: {
      enabled: false, frequency: 'weekly', day: 'monday', time: '08:00', monthlyCap: 20, notifyOnFailure: true,
      countries: ['py'], leadTypes: ['agents', 'agencies', 'developers'], maxPerRun: 50, requirePhone: true,
      sources: 'Century 21 Paraguay office directory\nRE/MAX Paraguay agent directory\nFacebook: inmobiliarias in Asunción\nInstagram: inmobiliarias in Paraguay',
    },
    fields: [
      { key: 'countries', type: 'multi', label: 'Countries', options: CC5 },
      { key: 'leadTypes', type: 'multi', label: 'Who to look for', options: [{ value: 'agents', label: 'Agents' }, { value: 'agencies', label: 'Agencies' }, { value: 'developers', label: 'Developers' }] },
      { key: 'sources', type: 'lines', label: 'Where to look', help: 'One directory, website or page per line.' },
      { key: 'maxPerRun', type: 'number', label: 'New contacts per run (max)', min: 1, max: 500 },
      { key: 'requirePhone', type: 'toggle', label: 'Only keep contacts with a phone number' },
    ],
  },
  {
    key: 'visibility',
    name: 'AI-answer visibility checker',
    product: 'bot',
    summary: 'Asks ChatGPT, Gemini, Perplexity and Grok our questions every week and records whether they recommend Casa-Libre, the words they use about us and which competitors they name.',
    chain: ['Grok Bot asks each AI app in a fresh session', 'Claude writes the weekly trend report', 'The team reads it in Admin Manager'],
    output: 'Every full answer, the sources each AI cites, the competitors named in order, and a weekly trend.',
    rules: ['Asks in a new session every time, so earlier chats do not change the answer.', 'Read only: never posts or reviews anything.'],
    defaults: {
      enabled: false, frequency: 'weekly', day: 'monday', time: '07:00', monthlyCap: 15, notifyOnFailure: true,
      assistants: ['chatgpt', 'gemini', 'perplexity', 'grok', 'google-ai'], countries: ['py', 'bo', 'uy', 've', 'sv'], languages: ['es', 'en'],
      questions: 'mejor sitio para comprar una casa en Paraguay\ndónde publicar mi casa gratis en Paraguay\nportal inmobiliario sin comisión en Paraguay\nbest website to find a house in Paraguay\ncómo vender mi casa rápido en Asunción',
      competitors: 'InfoCasas\nClasipar\nCentury 21\nRE/MAX',
    },
    fields: [
      { key: 'assistants', type: 'multi', label: 'AI apps to ask', options: [{ value: 'chatgpt', label: 'ChatGPT' }, { value: 'gemini', label: 'Gemini' }, { value: 'perplexity', label: 'Perplexity' }, { value: 'grok', label: 'Grok' }, { value: 'google-ai', label: 'Google AI answers' }] },
      { key: 'countries', type: 'multi', label: 'Countries', options: CC5 },
      { key: 'languages', type: 'multi', label: 'Languages', options: [{ value: 'es', label: 'Spanish' }, { value: 'en', label: 'English' }, { value: 'pt', label: 'Portuguese' }] },
      { key: 'questions', type: 'lines', label: 'Questions', help: 'One per line. The same questions every week, so the trend is fair.' },
      { key: 'competitors', type: 'lines', label: 'Competitors to look for in the answers' },
    ],
  },
  {
    key: 'competitor-watch',
    name: 'Competitor watch',
    product: 'bot',
    summary: 'A weekly report on InfoCasas, Century 21, RE/MAX and others: new features, prices, promotions, complaints, and good and bad news.',
    chain: ['Grok Bot reads their sites, Facebook, Instagram and X', 'Claude writes what to copy and what to avoid', 'The team reads it'],
    output: 'What changed at each competitor this week, with links, and Claude\'s lessons for us.',
    rules: ['Read only: never comments, likes or messages.', 'Internal report only: our public sites never name competitors.', 'Copy quotes exactly; never invent a review, post, date or URL.'],
    defaults: {
      enabled: false, frequency: 'weekly', day: 'friday', time: '08:00', monthlyCap: 20, notifyOnFailure: true,
      channels: ['website', 'facebook', 'instagram', 'x', 'news', 'app-reviews'], topics: ['features', 'prices', 'promotions', 'complaints', 'news'],
      competitors: 'InfoCasas | infocasas.com.py\nClasipar | clasipar.paraguay.com\nCentury 21 Paraguay | century21.com.py\nRE/MAX Paraguay | remax.com.py',
    },
    fields: [
      { key: 'competitors', type: 'lines', label: 'Competitors', help: 'One per line: name | website. Add their Facebook, Instagram or X pages after another |.' },
      { key: 'channels', type: 'multi', label: 'Where to look', options: [{ value: 'website', label: 'Website' }, { value: 'facebook', label: 'Facebook' }, { value: 'instagram', label: 'Instagram' }, { value: 'x', label: 'X' }, { value: 'news', label: 'News' }, { value: 'app-reviews', label: 'App reviews' }] },
      { key: 'topics', type: 'multi', label: 'What to report', options: [{ value: 'features', label: 'New features' }, { value: 'prices', label: 'Prices' }, { value: 'promotions', label: 'Promotions' }, { value: 'complaints', label: 'Complaints' }, { value: 'news', label: 'Good and bad news' }] },
    ],
  },
  {
    key: 'analyst-x',
    name: 'AI Analyst: X posts',
    product: 'bot',
    summary: 'Reads X posts from banks, ministries, news outlets and developers in our 5 countries and Brazil, so the AI Analyst can see events that start on X.',
    chain: ['Grok Bot searches the chosen X accounts', 'Saved with date and link', 'Claude (AI Analyst) decides what explains our numbers'],
    output: 'Dated X posts with links, per country, read by the AI Analyst.',
    rules: ['Never posts on X.', 'Claude tags every item strong, possible or unlikely as evidence.'],
    defaults: {
      enabled: false, frequency: 'daily', day: 'monday', time: '05:00', monthlyCap: 35, notifyOnFailure: true,
      countries: ['py', 'bo', 'uy', 've', 'sv', 'br'], maxPostsPerDay: 150, lookbackHours: 24,
      accounts: 'py: BCP (Banco Central del Paraguay), MUVH, ABC Color, Última Hora\nbo: Banco Central de Bolivia, Los Tiempos\nbr: Folha de S.Paulo, g1',
    },
    fields: [
      { key: 'countries', type: 'multi', label: 'Countries', options: COUNTRIES },
      { key: 'accounts', type: 'lines', label: 'X accounts to follow', help: 'One line per country: country code, then the accounts (up to 20 each). Hamza fills this list.' },
      { key: 'maxPostsPerDay', type: 'number', label: 'Posts read per day (max)', min: 10, max: 1000 },
      { key: 'lookbackHours', type: 'number', label: 'Look back (hours)', min: 6, max: 72 },
    ],
  },
  {
    key: 'news-feed',
    name: 'Daily X and news feed',
    product: 'bot',
    summary: 'One dated list of outside events (economy, interest rates, housing credit, viral local topics) for the AI Analyst and AI SEO.',
    chain: ['Grok Bot searches X and news sites', 'One list per country with date and link', 'AI Analyst and AI SEO read it'],
    output: 'The outside-events list: date, country, topic, headline, link.',
    rules: ['Only writes to an internal list; never posts.'],
    defaults: {
      enabled: false, frequency: 'daily', day: 'monday', time: '05:30', monthlyCap: 15, notifyOnFailure: true,
      countries: ['py', 'bo', 'uy', 've', 'sv', 'br'], topics: ['interest-rates', 'housing-credit', 'economy', 'exchange-rate', 'viral', 'property-law'],
      useX: true, useNews: true, maxPerCountry: 15,
    },
    fields: [
      { key: 'countries', type: 'multi', label: 'Countries', options: COUNTRIES },
      { key: 'topics', type: 'multi', label: 'Topics', options: [{ value: 'interest-rates', label: 'Interest rates' }, { value: 'housing-credit', label: 'Housing credit' }, { value: 'economy', label: 'Economy' }, { value: 'exchange-rate', label: 'Exchange rate' }, { value: 'viral', label: 'Viral local topics' }, { value: 'property-law', label: 'Property law and taxes' }] },
      { key: 'useX', type: 'toggle', label: 'Search X' },
      { key: 'useNews', type: 'toggle', label: 'Search news sites' },
      { key: 'maxPerCountry', type: 'number', label: 'Items per country per day (max)', min: 1, max: 50 },
    ],
  },
  {
    key: 'football',
    name: 'Football news site',
    product: 'bot',
    summary: 'Collects today\'s Paraguayan football news from X and the web every morning; Claude writes the articles.',
    chain: ['Grok Bot searches X and the web', 'Claude writes the articles', 'Published on the football site'],
    output: 'Today\'s match news with source links, turned into articles.',
    rules: ['Summarise and link the source; never copy an article.', 'Grok writes only when Anthropic credit has run out.'],
    defaults: {
      enabled: false, frequency: 'daily', day: 'monday', time: '07:00', monthlyCap: 10, notifyOnFailure: true,
      articlesPerDay: 5, grokFallback: true,
      teams: 'Albirroja (Paraguay national team)\nOlimpia\nCerro Porteño\nLibertad\nGuaraní\nPrimera División de Paraguay',
    },
    fields: [
      { key: 'teams', type: 'lines', label: 'Teams and leagues to follow' },
      { key: 'articlesPerDay', type: 'number', label: 'Articles per day', min: 1, max: 20 },
      { key: 'grokFallback', type: 'toggle', label: 'Let Grok write when Claude has no credit' },
    ],
  },
];

export const botByKey = (key) => BOTS.find((b) => b.key === key) || null;

// stored settings on top of the defaults: unknown keys dropped, wrong types fall back to the default
export function mergeBotSettings(bot, stored) {
  const out = { ...bot.defaults };
  if (!stored || typeof stored !== 'object') return out;
  for (const [k, def] of Object.entries(bot.defaults)) {
    const v = stored[k];
    if (v === undefined) continue;
    if (Array.isArray(def)) { if (Array.isArray(v)) out[k] = v.map(String); }
    else if (typeof def === typeof v) out[k] = v;
  }
  return out;
}

// problems to fix before saving → { fieldKey: message }
export function validateBotSettings(bot, s) {
  const errors = {};
  for (const f of [...COMMON_FIELDS, ...bot.fields]) {
    const v = s[f.key];
    if (f.type === 'number' && (!Number.isFinite(Number(v)) || Number(v) < (f.min ?? -Infinity) || Number(v) > (f.max ?? Infinity))) errors[f.key] = `Between ${f.min} and ${f.max}.`;
    if (f.type === 'multi' && (!Array.isArray(v) || !v.length)) errors[f.key] = 'Pick at least one.';
    if (f.type === 'lines' && !String(v || '').trim()) errors[f.key] = 'Add at least one line.';
    if (f.type === 'time' && !/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) errors[f.key] = 'Use HH:MM.';
  }
  return errors;
}

// "Every Monday at 08:00" / "Every day at 05:00"
export function scheduleLabel(s) {
  const t = s?.time || '';
  if (s?.frequency === 'weekly') { const d = DAYS.find((x) => x.value === s.day)?.label || 'week'; return `Every ${d} at ${t}`; }
  return `Every day at ${t}`;
}
