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

export const templateVars = [
  { key: 'name', label: 'First name', sample: 'Ana' },
  { key: 'property_title', label: 'Property title', sample: 'Casa 3 dorm · Villa Morra' },
  { key: 'property_url', label: 'Property link', sample: 'https://casa-libre.com.py/propiedad/ejemplo' },
  { key: 'free_until', label: 'Free display ends', sample: '2 de noviembre' },
  { key: 'days_left', label: 'Days left', sample: '3' },
  { key: 'free_days', label: 'Free days', sample: '30' },
  { key: 'extend_url', label: 'Pay-to-extend link', sample: 'https://casa-libre.com.py/api/promo/extend?token=ejemplo' },
  { key: 'price', label: 'Extension price', sample: 'US$20' },
  { key: 'views', label: 'Listing views', sample: '50' },
  { key: 'publish_url', label: 'Publish-a-listing link', sample: 'https://casa-libre.com.py/publicar' },
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

// Body text → HTML paragraphs. Escape the template first (tags survive escaping), then
// fill escaped values, then apply **bold** and [text](url).
export function bodyToHtml(body, vars = {}) {
  const filled = interpolate(esc(String(body ?? '')).replace(/\r\n/g, '\n'), vars);
  return filled
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
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
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '$1 ($2)');
}

// frame: { brand, tld, countryName, appleSrc, playSrc, downloadUrl }
//   appleSrc/playSrc = "cid:…" in real sends, data: URIs in the admin preview.
export function renderTemplate(tpl, vars = {}, frame = {}) {
  const subject = interpolate(tpl.subject, vars, { plain: true }).trim();
  const heading = interpolate(tpl.heading, vars);
  const bodyHtml = bodyToHtml(tpl.body, vars);
  const btnLabel = interpolate(tpl.button_label, vars).trim();
  const btnUrlRaw = interpolate(tpl.button_url, vars, { plain: true }).trim();
  const hasBtn = btnLabel && isHttp(btnUrlRaw);

  const badge = (src, alt, w) => (src
    ? `<a href="${esc(frame.downloadUrl || '#')}" style="text-decoration:none"><img src="${esc(src)}" alt="${alt}" width="${w}" height="43" style="display:block;border:0;outline:none;width:${w}px;height:43px"></a>`
    : '');

  const html = `<!doctype html><html><body style="margin:0;background:#f9f4ee;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;color:#111">
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
            <td valign="middle">${badge(frame.playSrc, 'Google Play', 145)}</td>
          </tr></table>
        </td></tr>` : ''}
      </table>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(17,17,17,.4);margin-top:16px">${esc(frame.brand || 'Casa Libre')} — ${esc(frame.countryName || '')}</div>
    </td></tr>
  </table></body></html>`;

  const text = [
    interpolate(tpl.heading, vars, { plain: true }).trim(),
    bodyToText(tpl.body, vars).trim(),
    hasBtn ? `${interpolate(tpl.button_label, vars, { plain: true }).trim()}: ${btnUrlRaw}` : '',
  ].filter(Boolean).join('\n\n');

  return { subject, html, text };
}
