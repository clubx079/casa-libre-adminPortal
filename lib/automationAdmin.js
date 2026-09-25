// Pure helpers for the Email templates + Automations pages (validation, stats, the
// per-country email frame). No I/O, so they're unit-tested in test/automationAdmin.test.js.
import { templateVars } from './emailTemplateRender.js';

export const AUTOMATION_ID = 'first_listing_free_home';
export const VIEWS_AUTOMATION_ID = 'listing_views_milestone';

// Same country facts the buyer portal renders emails with (lib/country.js there).
const COUNTRIES = {
  py: { tld: '.py', countryName: 'Paraguay', site: 'https://casa-libre.com.py', sender: 'casa-libre.com.py' },
  bo: { tld: '.bo', countryName: 'Bolivia', site: 'https://casa-libre.com.bo', sender: 'casa-libre.com.bo' },
  uy: { tld: '.uy', countryName: 'Uruguay', site: 'https://uy.casa-libre.com', sender: 'uy.casa-libre.com' },
  ve: { tld: '.ve', countryName: 'Venezuela', site: 'https://casa-libre.com.ve', sender: 'casa-libre.com.ve' },
};
export const countryInfo = (code) => COUNTRIES[String(code || '').toLowerCase()] || COUNTRIES.py;

// The frame lib/emailTemplateRender.js draws: badges are data URIs in the preview and
// cid: images in a real/test send.
export function countryFrame(code, badges = {}) {
  const c = countryInfo(code);
  return { brand: 'Casa Libre', tld: c.tld, countryName: c.countryName, downloadUrl: `${c.site}/descargar`, ...badges };
}

const KNOWN = new Set(templateVars.map((v) => v.key));
const unknownVars = (s) => [...String(s || '').matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]).filter((k) => !KNOWN.has(k));
const trimOrNull = (s) => { const v = String(s ?? '').trim(); return v || null; };

export function validateTemplate(input = {}) {
  const value = {
    name: String(input.name ?? '').trim(),
    subject: String(input.subject ?? '').trim(),
    heading: String(input.heading ?? '').trim(),
    body: String(input.body ?? '').replace(/\r\n/g, '\n').trim(),
    button_label: trimOrNull(input.button_label),
    button_url: trimOrNull(input.button_url),
    is_active: input.is_active !== false,
  };
  const errors = {};
  if (!value.name) errors.name = 'Give the template a name.';
  if (!value.subject) errors.subject = 'The subject is required.';
  if (!value.body) errors.body = 'Write the email body.';
  if (value.name.length > 120) errors.name = 'Keep the name under 120 characters.';
  if (value.subject.length > 200) errors.subject = 'Keep the subject under 200 characters.';
  if (value.button_label && !value.button_url) errors.button_url = 'Add the button link (a variable like {{property_url}} or an https:// address).';
  if (value.button_url && !/^\{\{\s*[a-z_]+url\s*\}\}$/i.test(value.button_url) && !/^https?:\/\/\S+$/i.test(value.button_url)) errors.button_url = 'The button link must be a link variable (e.g. {{extend_url}}) or start with https://';
  if (value.button_url && !value.button_label) errors.button_label = 'Add the button text.';
  for (const f of ['subject', 'heading', 'body', 'button_label', 'button_url']) {
    const bad = unknownVars(value[f]);
    if (bad.length && !errors[f]) errors[f] = `Unknown variable: {{${bad[0]}}}`;
  }
  return { ok: Object.keys(errors).length === 0, value, errors };
}

const RANGES = { wait_days: [0, 60], free_days: [1, 365], remind_days_before: [1, 60] };

// input = fields being changed; current = the saved row; nowIso stamps enabled_at.
export function validateSettings(input = {}, current = {}, nowIso = new Date().toISOString()) {
  const value = {};
  const errors = {};
  for (const [k, [min, max]] of Object.entries(RANGES)) {
    if (input[k] === undefined) continue;
    const n = Number(input[k]);
    if (!Number.isInteger(n) || n < min || n > max) errors[k] = `Between ${min} and ${max} days.`;
    else value[k] = n;
  }
  const free = value.free_days ?? current.free_days;
  const remind = value.remind_days_before ?? current.remind_days_before;
  if (free != null && remind != null && remind >= free && !errors.remind_days_before) errors.remind_days_before = 'The reminder must come before the free days end.';
  for (const k of ['gift_template_id', 'reminder_template_id']) if (input[k] !== undefined) value[k] = input[k] || null;
  if (input.enabled !== undefined) {
    value.enabled = !!input.enabled;
    if (value.enabled && !current.enabled) value.enabled_at = nowIso;
  }
  return { ok: Object.keys(errors).length === 0, value, errors };
}

export function automationStats(runs = [], payments = []) {
  const s = { inFlow: 0, gifted: 0, reminded: 0, converted: 0, done: 0, skipped: 0, revenueUsd: 0 };
  const convertedAt = new Map();
  for (const r of runs) {
    if (r.status === 'skipped') { s.skipped++; continue; }
    s.gifted++;
    if (r.status === 'gifted' || r.status === 'reminded') s.inFlow++;
    if (r.reminded_at || r.status === 'reminded') s.reminded++;
    if (r.status === 'converted') { s.converted++; convertedAt.set(String(r.property_id), r.gifted_at); }
    if (r.status === 'done') s.done++;
  }
  for (const p of payments) {
    const since = convertedAt.get(String(p.property_id));
    if (since && p.status === 'succeeded' && Date.parse(p.created_at) > Date.parse(since)) s.revenueUsd += Number(p.amount_usd) || 0;
  }
  s.revenueUsd = Math.round(s.revenueUsd * 100) / 100;
  return s;
}

// Which automation steps use a template (blocks deleting it; shown in the list).
export function templateUsage(templateId, automations = []) {
  const out = [];
  for (const a of automations) {
    if (a.id === VIEWS_AUTOMATION_ID) {
      if (String(a.template_id) === String(templateId)) out.push('Listing getting views → email');
      continue;
    }
    if (a.id !== AUTOMATION_ID) continue;
    if (String(a.gift_template_id) === String(templateId)) out.push('First listing → gift email');
    if (String(a.reminder_template_id) === String(templateId)) out.push('First listing → ending-soon email');
  }
  return out;
}

// "25, 50, 100" | [25, '50'] → sorted unique numbers (NaN kept as NaN to be rejected).
export function parseMilestones(input) {
  const parts = Array.isArray(input) ? input : String(input ?? '').split(/[,\s]+/).filter(Boolean);
  const nums = parts.map((x) => (/^\d+$/.test(String(x).trim()) ? Number(String(x).trim()) : NaN));
  return [...new Set(nums)].sort((a, b) => a - b);
}

// Settings for the "listing getting views" automation.
export function validateViewsSettings(input = {}, current = {}, nowIso = new Date().toISOString()) {
  const value = {};
  const errors = {};
  if (input.milestones !== undefined) {
    const m = parseMilestones(input.milestones);
    if (!m.length) errors.milestones = 'Add at least one view number, e.g. 50.';
    else if (m.some((n) => !Number.isInteger(n) || n < 1 || n > 1000000)) errors.milestones = 'Use whole numbers between 1 and 1,000,000, separated by commas.';
    else if (m.length > 10) errors.milestones = 'Use at most 10 view numbers.';
    else value.milestones = m;
  }
  if (input.template_id !== undefined) value.template_id = input.template_id || null;
  if (input.enabled !== undefined) {
    value.enabled = !!input.enabled;
    if (value.enabled && !current.enabled) value.enabled_at = nowIso;
  }
  const next = { ...current, ...value };
  if (next.enabled && !errors.milestones && (!next.template_id || !(next.milestones || []).length)) {
    errors.enabled = 'Set the view numbers and pick a template before switching it on.';
  }
  return { ok: Object.keys(errors).length === 0, value, errors };
}
