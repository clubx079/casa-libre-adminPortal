// Stage 5 — Check: the guardrails every change goes through (pure — test/seoGuards.test.js).
//   5-listing gate (variantState), title-change rate limit (canChangeTitle), no duplicate pages
//   (a variant needs its base page; one row per path), articles need approval (canPublishDraft).
import { MIN_LISTINGS, VARIANTS, parsePath } from './matrix.js';

const DAY = 86400000;

// Max one title change per `days` per page. → { ok, nextAt }
export function canChangeTitle(override, now = new Date(), days = 14) {
  const last = Date.parse(override?.title_changed_at || 0);
  if (!last) return { ok: true, nextAt: null };
  const next = last + days * DAY;
  return next <= now.getTime() ? { ok: true, nextAt: null } : { ok: false, nextAt: new Date(next).toISOString() };
}

// What the website does with a variant page:
//   'index'   switched on and ≥5 listings → rendered, indexed, in the sitemap
//   'noindex' switched on with 1–4 listings, or retired by the weekly loop → rendered, not indexed
//   'off'     not switched on, unknown, or no listings → 404
export function variantState({ variant, count = 0, enabled = false, retired = false, min = MIN_LISTINGS }) {
  if (!VARIANTS[variant] || !count) return 'off';
  if (enabled) return count >= min ? 'index' : 'noindex';
  if (retired) return 'noindex';
  return 'off';
}

// May this variant be switched on? Needs a real variant of a real city page and ≥5 listings.
export function canEnableVariant(path, count, min = MIN_LISTINGS) {
  const p = parsePath(path);
  if (!p || !p.variant) return { ok: false, why: 'not a variant page' };
  if ((count || 0) < min) return { ok: false, why: `only ${count || 0} listings (needs ${min})` };
  return { ok: true };
}

export function canPublishDraft(draft) {
  if (!draft) return { ok: false, why: 'not found' };
  if (draft.status !== 'approved') return { ok: false, why: 'a person must approve it first' };
  if (!draft.title || !draft.h1 || !(draft.sections || []).length) return { ok: false, why: 'title, H1 and at least one section are needed' };
  return { ok: true };
}

// A title must be a real sentence for the page: 15–70 characters, no placeholders left.
export function cleanTitle(s) {
  const t = String(s || '').replace(/\s+/g, ' ').trim();
  if (t.length < 15 || t.length > 70 || /\{\{|\}\}/.test(t)) return null;
  return t;
}
