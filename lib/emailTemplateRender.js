// Renders an admin-editable email template into the Casa Libre branded email.
// The SAME file lives in the admin portal (live preview + test send) and the buyer
// portal (automation sends), so what an admin previews is exactly what users get.
// Pure: no imports, no env, no I/O.
//
// Template fields: subject, heading, body, button_label, button_url.
//   {{var}}            → the value, HTML-escaped (keys ending in "url" must be http/https)
//   blank line in body → new paragraph
//   **bold**           → bold
//   [text](https://…)  → link (only http/https)
//   ![alt](https://…)  → full-width image (only http/https; left out when the url is
//                        empty — e.g. ![…]({{photo_url}}) for a draft without photos)
//   Newsletter blocks (a paragraph on its own):
//   >> text            → FIRST line only: the inbox preview text (preheader), hidden in the email
//   ## Title           → section title
//   !! 57 % | text     → a big number with its explanation (data insight)
//   [[Label]](url)     → an extra button (outlined; the main button stays button_label/url)
//   ---                → divider

// Weekly newsletter (buyer lib/newsletter/): links + numbers measured that week (PostHog + this
// country's DB). A newsletter whose nl_* number could not be measured is skipped that week.
export const NEWSLETTER_VARS = [
  { key: 'country_name', label: 'Country name', sample: 'Paraguay' },
  { key: 'newsletter_url', label: 'Newsletter page on the website (/newsletter)', sample: 'https://casa-libre.com.py/newsletter' },
  { key: 'stories_url', label: 'Success stories on the newsletter page', sample: 'https://casa-libre.com.py/newsletter#historias' },
  { key: 'search_url', label: 'Listings search page', sample: 'https://casa-libre.com.py/propiedades' },
  { key: 'app_url', label: 'Download-the-app page', sample: 'https://casa-libre.com.py/descargar' },
  { key: 'nl_people_30d', label: 'Newsletter: people who looked at listings, last 30 days (rounded down)', sample: '2.500' },
  { key: 'nl_views_30d', label: 'Newsletter: listing views, last 30 days (rounded down)', sample: '7.600' },
  { key: 'nl_top_cities', label: 'Newsletter: the 3 most viewed cities', sample: 'Asunción, Encarnación y Luque' },
  { key: 'nl_top_searches', label: 'Newsletter: the 3 most searched places', sample: 'Ciudad del Este, Luque y Asunción' },
  { key: 'nl_top_types', label: 'Newsletter: most viewed property types with share', sample: 'casas (41 %) y departamentos (40 %)' },
  { key: 'nl_sale_median', label: 'Newsletter: median price of the homes for sale people looked at', sample: 'US$84.000' },
  { key: 'nl_sale_under_100k_pct', label: 'Newsletter: % of for-sale views under US$100.000', sample: '57' },
  { key: 'nl_rent_band', label: 'Newsletter: most viewed monthly rent range', sample: 'US$400 a US$700' },
  { key: 'nl_rent_band_pct', label: 'Newsletter: % of rent views in that range', sample: '35' },
  { key: 'nl_rent_searches', label: 'Newsletter: rent searches, last 30 days (rounded down)', sample: '13.200' },
  { key: 'nl_sale_searches', label: 'Newsletter: for-sale searches, last 30 days (rounded down)', sample: '7.500' },
  { key: 'nl_direct_ratio', label: 'Newsletter: listings published directly get N times the views of imported ones', sample: '2' },
  { key: 'nl_photo_ratio', label: 'Newsletter: listings with photos get N times the views of listings without', sample: '3' },
];

export const templateVars = [
  { key: 'name', label: 'First name', sample: 'Ana' },
  { key: 'property_title', label: 'Property title', sample: 'Casa 3 dorm · Villa Morra' },
  { key: 'property_url', label: 'Property link', sample: 'https://casa-libre.com.py/propiedad/ejemplo' },
  { key: 'free_until', label: 'Free display ends', sample: '2 de noviembre' },
  { key: 'days_left', label: 'Days left', sample: '3' },
  { key: 'free_days', label: 'Free days', sample: '30' },
  { key: 'extend_url', label: 'Pay-to-extend link', sample: 'https://casa-libre.com.py/api/promo/extend?token=ejemplo' },
  { key: 'claim_url', label: 'Verify-and-claim link (first-listing gift)', sample: 'https://casa-libre.com.py/api/gift/claim?token=ejemplo' },
  { key: 'price', label: 'Price (depends on the email: extension, listing or home-page price — the preview shows the real one)', sample: 'US$5' },
  { key: 'views', label: 'Listing views', sample: '50' },
  { key: 'saves', label: 'People who saved the listing', sample: '10' },
  { key: 'publish_url', label: 'Publish-a-listing link', sample: 'https://casa-libre.com.py/publicar' },
  { key: 'feedback_url', label: 'Feedback form link ("why did you delete it?" — one-tap reasons + comment)', sample: 'https://casa-libre.com.py/feedback?src=listing_deleted' },
  { key: 'draft_url', label: 'Unfinished draft link (opens it in the wizard)', sample: 'https://casa-libre.com.py/cuenta/publicaciones?tab=borradores&draft=ejemplo' },
  { key: 'draft_location', label: 'Draft neighborhood, city', sample: 'Villa Morra, Asunción' },
  { key: 'photo_url', label: 'Draft first photo — use as ![…]({{photo_url}})', sample: 'https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=800&q=70' },
  { key: 'listing_links', label: 'Links to each copy of a repeated listing (one per line)', sample: '[Publicación 1 · 3 de octubre](https://casa-libre.com.py/propiedad/ejemplo-1)\n[Publicación 2 · 9 de octubre](https://casa-libre.com.py/propiedad/ejemplo-2)' },
  { key: 'listing_count', label: 'How many times it was listed', sample: '2' },
  { key: 'my_listings_url', label: 'My listings page link', sample: 'https://casa-libre.com.py/cuenta/publicaciones' },
  { key: 'listing_until', label: 'Paid listing end date', sample: '10 de enero' },
  { key: 'free_limit', label: 'Free listings per month', sample: '3' },
  { key: 'business_url', label: 'Plans for agents page link', sample: 'https://casa-libre.com.py/empresas' },
  { key: 'paid_days', label: 'Days a paid listing stays live', sample: '60' },
  { key: 'missing', label: 'What a listing is missing (e.g. precio y fotos)', sample: 'precio y fotos' },
  { key: 'referral_url', label: "Referral program: the person's own referral link", sample: 'https://casa-libre.com.py/ref/abcd2345' },
  { key: 'referrals_url', label: 'Referral program: their Referrals page (Mi cuenta)', sample: 'https://casa-libre.com.py/cuenta/referidos' },
  { key: 'referral_count', label: 'Referral program: people who listed with their link', sample: '3' },
  { key: 'referred_name', label: 'Referral program: the invited person (first name + initial)', sample: 'Ana P.' },
  { key: 'referrer_name', label: 'Referral program: who invited them (first name + initial)', sample: 'Carlos G.' },
  { key: 'reward_plan', label: 'Referral program: what the reward gives', sample: 'la insignia Verificada' },
  { key: 'reward_days', label: 'Referral program: days a referrer earns per person', sample: '30' },
  { key: 'new_user_days', label: 'Referral program: days the invited person gets', sample: '30' },
  { key: 'milestone_count', label: 'Referral program: invited people for the home-page reward', sample: '3' },
  { key: 'milestone_days', label: 'Referral program: home-page reward days', sample: '30' },
  { key: 'active_listings', label: 'Live listings on the site, rounded down (proof line)', sample: '3.600' },
  { key: 'settings_url', label: 'Personalize your profile: Settings link (Mi cuenta → Ajustes)', sample: 'https://casa-libre.com.py/cuenta/ajustes' },
  { key: 'progress_line', label: 'Personalize your profile: how far they got + what is missing', sample: 'Ya empezaste: tu perfil está al 43 % (3 de 7). Te falta: foto o logo, empresa, sitio web, WhatsApp confirmado.' },
  { key: 'progress_pct', label: 'Personalize your profile: completion %', sample: '43' },
  ...NEWSLETTER_VARS,
];

export const sampleVars = Object.fromEntries(templateVars.map((v) => [v.key, v.sample]));

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const isHttp = (u) => /^https?:\/\/[^\s]+$/i.test(String(u || '').trim());
const TAG = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

// {{var}} substitution. Default = HTML-escaped (for markup). plain = raw text (subjects,
// the plain-text part). URL keys are dropped unless they are http(s).
export function interpolate(str, vars = {}, { plain = false } = {}) {
  return String(str ?? '').replace(TAG, (_, key) => {
    const v = vars[key];
    if (v == null) return '';
    if (key.endsWith('url') && !isHttp(v)) return '';
    return plain ? String(v) : esc(v);
  });
}

const IMG = /!\[([^\]]*)\]\(([^)\s]*)\)/g;
const BTN = /^\[\[([^\]]+)\]\]\(([^)\s]+)\)$/;

// ">> text" as the body's first line = the inbox preview text (preheader). → { preheader, body }
export function splitPreheader(body) {
  const src = String(body ?? '').replace(/\r\n/g, '\n');
  const m = /^\s*>>[ \t]*([^\n]*)\n?/.exec(src);
  return m ? { preheader: m[1].trim(), body: src.slice(m[0].length) } : { preheader: '', body: src };
}

// One newsletter block (already escaped + filled) → HTML, or null for a normal paragraph.
function blockHtml(p) {
  if (/^-{3,}$/.test(p)) return '<div style="height:1px;background:rgba(17,17,17,.1);margin:18px 0"></div>';
  if (p.startsWith('## ')) return `<div style="margin:20px 0 8px;font-size:16px;font-weight:700;letter-spacing:-0.01em;color:#111">${p.slice(3).trim()}</div>`;
  const stat = /^!!\s+([^|]+?)\s*\|\s*([\s\S]+)$/.exec(p);
  if (stat) return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 12px;background:#f9f4ee;border-radius:14px"><tr><td style="padding:14px 16px"><div style="font-size:26px;font-weight:700;letter-spacing:-0.02em;color:#111;line-height:1.1">${stat[1]}</div><div style="font-size:13.5px;line-height:1.5;color:rgba(17,17,17,.7);margin-top:4px">${stat[2].replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>')}</div></td></tr></table>`;
  const b = BTN.exec(p);
  if (b) {
    const raw = b[2].replace(/&amp;/g, '&');
    return isHttp(raw) ? `<div style="margin:4px 0 14px"><a href="${b[2]}" style="display:block;border:1.5px solid #111;color:#111;text-decoration:none;font-size:15px;font-weight:700;text-align:center;padding:13px 20px;border-radius:999px">${b[1]}</a></div>` : '';
  }
  return null;
}

// Body text → HTML paragraphs. Escape the template first (tags survive escaping), then
// fill escaped values, then apply ![alt](url) images, **bold** and [text](url). A
// paragraph left empty by an image without a url is dropped.
export function bodyToHtml(body, vars = {}) {
  const filled = interpolate(esc(String(body ?? '')).replace(/\r\n/g, '\n'), vars);
  return filled
    .split(/\n\s*\n/)
    .map((p) => p.replace(IMG, (m, alt, url) => (isHttp(url.replace(/&amp;/g, '&'))
      ? `<img src="${url}" alt="${alt}" width="396" style="display:block;width:100%;max-width:396px;height:auto;border:0;border-radius:14px">`
      : '')).trim())
    .filter(Boolean)
    .map((p) => {
      const block = blockHtml(p);
      if (block !== null) return block;
      let h = p.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
      h = h.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, text, url) => {
        const raw = url.replace(/&amp;/g, '&');
        return isHttp(raw) ? `<a href="${url}" style="color:#111;text-decoration:underline">${text}</a>` : m;
      });
      h = h.replace(/\n/g, '<br>');
      return `<p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:rgba(17,17,17,.75)">${h}</p>`;
    })
    .join('');
}

function bodyToText(body, vars) {
  return interpolate(String(body ?? ''), vars, { plain: true })
    .replace(IMG, '')
    .replace(/^\[\[([^\]]+)\]\]\(([^)\s]+)\)$/gm, '$1: $2')
    .replace(/^!!\s+([^|\n]+?)\s*\|\s*/gm, '$1 — ')
    .replace(/^## /gm, '')
    .replace(/^-{3,}$/gm, '')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
}

// frame: { brand, tld, countryName, appleSrc, playSrc, downloadUrl, playUrl }
//   appleSrc/playSrc = "cid:…" in real sends, data: URIs in the admin preview.
//   The App Store badge opens downloadUrl (the App Store page); Google Play opens playUrl
//   (the app's store page), falling back to downloadUrl.
export function renderTemplate(tpl, vars = {}, frame = {}) {
  const subject = interpolate(tpl.subject, vars, { plain: true }).trim();
  const heading = interpolate(tpl.heading, vars);
  const { preheader: pre, body } = splitPreheader(tpl.body);
  const preheader = interpolate(pre, vars);
  const bodyHtml = bodyToHtml(body, vars);
  const btnLabel = interpolate(tpl.button_label, vars).trim();
  const btnUrlRaw = interpolate(tpl.button_url, vars, { plain: true }).trim();
  const hasBtn = btnLabel && isHttp(btnUrlRaw);

  const badge = (src, alt, w, href = frame.downloadUrl) => (src
    ? `<a href="${esc(href || '#')}" style="text-decoration:none"><img src="${esc(src)}" alt="${alt}" width="${w}" height="43" style="display:block;border:0;outline:none;width:${w}px;height:43px"></a>`
    : '');

  const html = `<!doctype html><html><body style="margin:0;background:#f9f4ee;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;color:#111">${preheader ? `
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all">${preheader}&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>` : ''}
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f4ee;padding:32px 0">
    <tr><td align="center">
      <table width="460" cellpadding="0" cellspacing="0" style="background:#fff;border:1.5px solid rgba(17,17,17,.12);border-radius:20px;overflow:hidden">
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.03em">casa-libre<span style="font-style:italic">${esc(frame.tld || '.py')}</span></div>
        </td></tr>
        ${heading ? `<tr><td style="padding:8px 32px 0"><div style="font-size:20px;font-weight:700;letter-spacing:-0.02em;margin-bottom:12px">${heading}</div></td></tr>` : ''}
        <tr><td style="padding:0 32px">${bodyHtml}</td></tr>
        ${hasBtn ? `<tr><td style="padding:12px 32px 28px"><a href="${esc(btnUrlRaw)}" style="display:inline-block;background:#111;color:#f9f4ee;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px">${btnLabel}</a></td></tr>` : '<tr><td style="padding:0 0 16px"></td></tr>'}
        ${frame.appleSrc || frame.playSrc ? `<tr><td align="center" style="padding:20px 24px 26px;border-top:1px solid rgba(17,17,17,.08)">
          <div style="font-size:13px;color:rgba(17,17,17,.6);margin-bottom:12px">Funciona mejor en la app</div>
          <table cellpadding="0" cellspacing="0" border="0" style="margin:0 auto"><tr>
            <td valign="middle">${badge(frame.appleSrc, 'App Store', 153)}</td>
            <td style="width:12px">&nbsp;</td>
            <td valign="middle">${badge(frame.playSrc, 'Google Play', 145, frame.playUrl || frame.downloadUrl)}</td>
          </tr></table>
        </td></tr>` : ''}
      </table>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(17,17,17,.4);margin-top:16px">${esc(frame.brand || 'Casa-Libre')} — ${esc(frame.countryName || '')}</div>
    </td></tr>
  </table></body></html>`;

  const text = [
    interpolate(tpl.heading, vars, { plain: true }).trim(),
    bodyToText(body, vars).trim(),
    hasBtn ? `${interpolate(tpl.button_label, vars, { plain: true }).trim()}: ${btnUrlRaw}` : '',
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
