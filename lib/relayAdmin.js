// The WhatsApp templates in Relay (relay.airosofts.com, project "Casa Libre" — the same
// list for every country), for the Templates → WhatsApp tab and the Automations pickers.
// Read-only: templates are created and approved in Relay itself. Env RELAY_API_KEY
// (+ RELAY_BASE_URL). Cached 60 s.
import 'server-only';
import { WA_TEMPLATES } from './whatsappTemplates.js';

const base = () => String(process.env.RELAY_BASE_URL || 'https://relay.airosofts.com/v1').replace(/\/+$/, '');
const key = () => String(process.env.RELAY_API_KEY || '').trim();
export const relayConfigured = () => !!key();
export const RELAY_TEMPLATES_URL = 'https://relay.airosofts.com/p/casa-libre/templates';

let cache = null;
export async function relayTemplates({ fresh = false } = {}) {
  if (!key()) return { configured: false, templates: [] };
  if (!fresh && cache && Date.now() - cache.at < 60 * 1000) return cache.data;
  const r = await fetch(`${base()}/templates?status=all`, { headers: { Authorization: `Bearer ${key()}` }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j?.error?.message || `Relay ${r.status}`);
  const templates = (j.data || []).map((t) => ({
    name: t.name, language: t.language, category: String(t.category || '').toLowerCase(), status: String(t.status || '').toUpperCase(),
    body: t.body || '', variables: t.variables || null, updated_at: t.updated_at || null,
    supported: !!WA_TEMPLATES[t.name],   // the automations know how to fill it (lib/whatsappTemplates.js)
  })).sort((a, b) => a.name.localeCompare(b.name));
  const data = { configured: true, templates };
  cache = { at: Date.now(), data };
  return data;
}
