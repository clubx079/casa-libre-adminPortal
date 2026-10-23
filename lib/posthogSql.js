// HogQL building blocks shared by the Analytics route (app/api/analytics/posthog) and the
// Admin Manager's weekly data pack (lib/manager/dataPack.js), so both count the same way.

// Unique-visitor key: an identified user counts by their person_id; an
// anonymous visitor counts by their IP address, so many browser sessions from
// the same IP collapse into ONE "person" in every count/funnel.
export const UKEY = `if(coalesce(person.properties.email, '') != '', toString(person_id), coalesce(nullIf(properties.$ip, ''), 'unknown'))`;

// Where a visit came from, in priority order: AI engines (they tag their own
// links), then any utm tag, then the referring domain, then 'direct'. Organic
// Google is a google referrer with no tag.
//
// String.raw on purpose: a plain template hands ClickHouse '\.', which it
// unescapes to '.' (any character). '\\.' below reaches it as a literal dot.
export const SOURCE_EXPR = String.raw`
  multiIf(
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(chatgpt|openai)'), 'chatgpt',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)perplexity'), 'perplexity',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(gemini|bard\\.google)'), 'gemini',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(claude|anthropic)'), 'claude',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(copilot|bing chat)'), 'copilot',
    match(concat(coalesce(properties.utm_source, ''), ' ', coalesce(properties.$referring_domain, '')), '(?i)(grok|x\\.ai|deepseek|mistral)'), 'other ai',
    coalesce(nullIf(properties.utm_source, ''), '') != '', lower(properties.utm_source),
    match(coalesce(properties.$referring_domain, ''), '(?i)^accounts\\.google\\.'), 'direct',
    match(coalesce(properties.$referring_domain, ''), '(?i)^mail\\.google\\.'), 'email',
    match(coalesce(properties.$referring_domain, ''), '(?i)(^|\\.)google\\.'), 'google',
    match(coalesce(properties.$referring_domain, ''), '(?i)bing\\.'), 'bing',
    match(coalesce(properties.$referring_domain, ''), '(?i)duckduckgo\\.'), 'duckduckgo',
    match(coalesce(properties.$referring_domain, ''), '(?i)(yahoo|ecosia|brave)\\.'), 'search',
    match(coalesce(properties.$referring_domain, ''), '(?i)(^|\\.)reddit\\.'), 'reddit',
    match(coalesce(properties.$referring_domain, ''), '(?i)(instagram|facebook|^fb\\.|tiktok|linkedin|twitter|^x\\.com)'), 'social',
    match(coalesce(properties.$referring_domain, ''), '(?i)(whatsapp|wa\\.me)'), 'whatsapp',
    coalesce(properties.$referring_domain, '') IN ('', '$direct'), 'direct',
    match(coalesce(properties.$referring_domain, ''), '(?i)(casa-libre|localhost|airosofts)'), 'direct',
    lower(properties.$referring_domain)
  )`;

// The AI engines, so the admin can show them on their own — this is the number
// Roland's AI-visibility work moves.
export const AI_SOURCES = ['chatgpt', 'perplexity', 'gemini', 'claude', 'copilot', 'other ai'];

// Investor-facing geo policy. Pakistan (the dev team) is NEVER shown. Saudi
// Arabia's historical test traffic is hidden, but any Saudi visits from the
// cutoff date onward DO show. Applied to every aggregate query. Uses
// coalesce so events with an unresolved country are kept, not dropped.
export const HIDE_SAUDI_BEFORE = '2026-09-21';
export const GEO_BASE = `coalesce(properties.$geoip_country_name, '') != 'Pakistan' AND NOT (coalesce(properties.$geoip_country_name, '') = 'Saudi Arabia' AND timestamp < toDateTime('${HIDE_SAUDI_BEFORE} 00:00:00'))`;

// "Contacted a seller": the property page's WhatsApp / call / copy-number buttons
// (contact_*_click). contact_seller_clicked is the old button, kept for history.
export const CONTACT_EVENTS = ['contact_whatsapp_click', 'contact_call_click', 'contact_copy_click', 'contact_seller_clicked'];
export const CONTACT_IN = `event IN (${CONTACT_EVENTS.map((e) => `'${e}'`).join(', ')})`;
