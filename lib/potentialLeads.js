// Potential leads (Admin → Leads): businesses we found ourselves — e.g. property
// developers listed on HolaCasa — to contact later. Pure helpers shared by the API,
// the page and the importer (scripts/import-potential-leads.mjs).

export const LEAD_STATUSES = ['new', 'contacted', 'interested', 'client', 'discarded'];
export const STATUS_LABEL = { new: 'New', contacted: 'Contacted', interested: 'Interested', client: 'Client', discarded: 'Discarded' };
export const CATEGORY_LABEL = { developer: 'Developer', agency: 'Agency', other: 'Other' };

// Where each source's list lives (shown as the lead's origin).
export const SOURCES = {
  holacasa: { label: 'HolaCasa', list: 'https://holacasa.com.py/desarrolladoras/' },
};

const clean = (v, max = 300) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

// One scraped row → a potential_leads row. Returns null when it can't be stored
// (needs a name and a real http(s) source page — that's the de-duplication key).
export function toLeadRow(raw, { source, category = 'developer' } = {}) {
  const name = clean(raw?.name, 200);
  const url = clean(raw?.profile_url || raw?.source_url, 500);
  if (!name || !url || !/^https?:\/\//i.test(url) || !source) return null;
  return {
    name,
    legal_name: clean(raw.legal_name, 200),
    category: CATEGORY_LABEL[category] ? category : 'other',
    phone: clean(raw.phone, 60),
    whatsapp: clean(raw.whatsapp, 60),
    email: clean(raw.email, 200),
    location: clean(raw.location, 200),
    source,
    source_url: url,
  };
}

// wa.me needs full international digits (Paraguay = 595).
export function waDigits(p) {
  const d = String(p || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('595')) return d;
  if (d.startsWith('0')) return '595' + d.slice(1);
  return '595' + d;
}

export const hasContact = (r) => !!(r?.phone || r?.whatsapp || r?.email);

// Search + filters used by the page.
export function filterLeads(rows, { q = '', status = 'all', contact = 'all' } = {}) {
  const n = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const nq = n(q).trim();
  return (rows || []).filter((r) => {
    if (status !== 'all' && r.status !== status) return false;
    if (contact === 'with' && !hasContact(r)) return false;
    if (contact === 'without' && hasContact(r)) return false;
    if (nq && ![r.name, r.legal_name, r.location, r.phone, r.whatsapp, r.email].some((v) => n(v).includes(nq))) return false;
    return true;
  });
}
