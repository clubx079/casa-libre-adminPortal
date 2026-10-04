// COPY of the buyer portal's lib/campaigns.js — keep IDENTICAL (test/campaigns.test.js
// fails if the channels or old-link aliases differ).
//
// UTM links — ONE short link per channel.
//
// Every link we place anywhere (every Reddit reply, the Instagram bio, a Meta ad…)
// is that channel's link:  <site>/r/<slug>  → redirects to the home page WITH utm
// tags, and the redirect records the click. The admin's "UTM Links" page lists these
// links and shows, per channel, how many times the link was opened and how many
// people landed on the site from it.
//
// The admin keeps an IDENTICAL copy of this file (its tests fail if they differ):
// adding a channel = one line here + the same line there.
//
// slug   → the short code in the link
// label  → the channel's name in the admin
// source → utm_source · medium → utm_medium · name → utm_campaign

export const CAMPAIGNS = {
  rd: { label: 'Reddit', source: 'reddit', medium: 'social', name: 'reddit' },
  fb: { label: 'Facebook', source: 'facebook', medium: 'social', name: 'facebook' },
  ig: { label: 'Instagram', source: 'instagram', medium: 'social', name: 'instagram' },
  x: { label: 'X', source: 'x', medium: 'social', name: 'x' },
  tt: { label: 'TikTok', source: 'tiktok', medium: 'social', name: 'tiktok' },
  meta: { label: 'Meta ads', source: 'meta', medium: 'cpc', name: 'meta_ads' },
  gads: { label: 'Google ads', source: 'google', medium: 'cpc', name: 'google_ads' },
  wa: { label: 'WhatsApp', source: 'whatsapp', medium: 'outreach', name: 'whatsapp' },
  mail: { label: 'Email', source: 'email', medium: 'email', name: 'email' },
};

// Older links that are already out there (Reddit replies, bios). They keep working
// and count under their channel.
export const ALIASES = {
  rda: 'rd', rdsell: 'rd', rdbuy: 'rd', rdrent: 'rd',
  igs: 'ig',
  metasell: 'meta',
};

// 'rda' → 'rd', 'x' → 'x', unknown → null.
export function resolveSlug(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (CAMPAIGNS[s]) return s;
  return ALIASES[s] || null;
}

// The page a channel's link lands on, with its utm tags. null for an unknown slug.
export function campaignUrl(site, slug) {
  const key = resolveSlug(slug);
  if (!key) return null;
  const c = CAMPAIGNS[key];
  const base = String(site || '').replace(/\/$/, '');
  const qs = new URLSearchParams({ utm_source: c.source, utm_medium: c.medium, utm_campaign: c.name });
  return `${base}/?${qs.toString()}`;
}

export const campaignSlugs = () => Object.keys(CAMPAIGNS);
