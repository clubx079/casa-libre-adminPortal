// User activity → "Preview": the exact email or WhatsApp message a person received, for the
// pop-up in components/users/UserTimeline.js (data: app/api/users/preview). Pure helpers —
// test/messagePreview.test.js.

// An email's HTML, safe to show in a sandboxed <iframe srcDoc>: no scripts, no inline event
// handlers, links open in a new tab, and the inline (cid:) app badges — which only exist as
// attachments — dropped instead of showing as broken images.
export function safeEmailHtml(html) {
  let s = String(html || '');
  s = s.replace(/<script\b[\s\S]*?<\/script>/gi, '');
  s = s.replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  s = s.replace(/<img\b[^>]*\bsrc\s*=\s*["']cid:[^"']*["'][^>]*>/gi, '');
  s = s.replace(/javascript:/gi, '');
  const base = '<base target="_blank">';
  return /<head[^>]*>/i.test(s) ? s.replace(/<head([^>]*)>/i, `<head$1>${base}`) : `${base}${s}`;
}

// The variables a Relay message was sent with, in order ({{1}}, {{2}}…), whatever shape Relay
// returned them in. [] when the message doesn't carry them.
export function relayVariables(m) {
  const t = m && typeof m.template === 'object' ? m.template : {};
  const raw = t.variables ?? t.params ?? t.parameters ?? m?.variables ?? m?.template_variables ?? null;
  if (Array.isArray(raw)) return raw.map((v) => (v && typeof v === 'object' ? (v.text ?? v.value ?? '') : v)).map((v) => String(v ?? ''));
  if (raw && typeof raw === 'object') {
    const keys = Object.keys(raw).sort((a, b) => Number(a) - Number(b));
    return keys.map((k) => String(raw[k] ?? ''));
  }
  const comps = Array.isArray(t.components) ? t.components : [];
  const body = comps.find((c) => String(c?.type || '').toLowerCase() === 'body');
  return Array.isArray(body?.parameters) ? body.parameters.map((p) => String(p?.text ?? '')) : [];
}

// A template's text with its {{n}} filled; a missing value stays visible as {{n}}.
export function fillTemplate(body, vars = []) {
  let filled = 0;
  const text = String(body || '').replace(/\{\{\s*(\d+)\s*\}\}/g, (all, n) => {
    const v = vars[Number(n) - 1];
    if (v == null || v === '') return all;
    filled++;
    return v;
  });
  return { text, complete: !/\{\{\s*\d+\s*\}\}/.test(text), filled };
}

// One Relay message → what the pop-up shows.
export function relayPreview(m, templateBody = '') {
  const tplName = (typeof m?.template === 'string' ? m.template : m?.template?.name) || '';
  const own = String(m?.text || m?.button?.text || m?.media?.caption || '').trim();
  const vars = relayVariables(m);
  const fromTemplate = tplName && templateBody ? fillTemplate(templateBody, vars) : null;
  return {
    direction: m?.direction === 'inbound' ? 'inbound' : 'outbound',
    at: m?.timestamps?.created || m?.created_at || null,
    status: m?.error?.message || m?.status === 'failed' ? 'failed' : String(m?.status || '').toLowerCase() || null,
    template: tplName || null,
    text: own || fromTemplate?.text || '',
    complete: own ? true : fromTemplate ? fromTemplate.complete : true,
    media: m?.media?.url || m?.media?.link ? { type: m.media.type || m.type || 'file', url: m.media.url || m.media.link } : null,
    buttons: Array.isArray(m?.template?.buttons) ? m.template.buttons.map((b) => String(b?.text || b?.title || '')).filter(Boolean) : [],
  };
}
