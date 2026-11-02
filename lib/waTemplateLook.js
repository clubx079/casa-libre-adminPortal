// What a WhatsApp template looks like on the phone — for the previews in the admin (Sent
// campaigns → Preview, a batch's page), in Spanish (what was sent) and English (for the team).
// Relay's API gives a template's body and its header TYPE only: not the header media, the
// footer or the button labels. So the campaign templates are described here, with their
// header media in public/wa-templates/ (the files that were submitted to Meta with them) and
// their English text. Any other template still previews: its body, a placeholder for the
// header, a generic button; its English comes from the translate route.

// Where the campaign button lands, WITHOUT the batch's tracking (opening it from the admin
// must not count as a click): the home page with the sell wizard open (website /r/wa?sell=1).
export const SELL_URL = 'https://casa-libre.com.py/?sell=1';

const V2 = { footer: 'Casa-Libre', url: SELL_URL };
const V1 = { url: SELL_URL };
const EN = {
  texto: 'Hi {{1}}, this is {{brand}}, the property portal of Paraguay. Agents and real-estate agencies list their properties for free and get the contacts straight to their WhatsApp. Want to add yours? It takes 2 minutes.',
  gif: 'Hi {{1}}, look how {{brand}} is moving 📈 Thousands of people search for houses, apartments and land in Paraguay, and every month more buyers write directly on WhatsApp to whoever lists. Add your properties for free.',
  imagen: 'Hi {{1}}, this is what {{brand}} looks like inside: thousands of visits every month and buyers who write directly on WhatsApp to whoever lists. List your properties for free and start getting contacts.',
  video: 'Hi {{1}}, in 30 seconds we show you {{brand}}: you list your property for free, it shows up on the map and interested people contact you on WhatsApp. Ideal for agents and real-estate agencies in Paraguay.',
};
const en = (k, brand, buttons) => ({ body: EN[k].replace('{{brand}}', brand), buttons });
const PORFIN_EN = {
  body: "Hi {{1}}, it's finally here! A marketplace for buyers and sellers, with the leading technology. Casa-Libre is a partnership between leading US technology and Paraguay's local needs. Tap the button to set up your account and claim your FREE listing today.",
  buttons: ['Claim your listing'],
};
const PORFIN = { footer: 'Casa-Libre', url: SELL_URL, buttons: ['Reclamar publicación'], en: PORFIN_EN };
const GIF = { type: 'gif', src: '/wa-templates/publica-gif.mp4' };
const IMG = { type: 'image', src: '/wa-templates/publica-imagen.png' };
const VID = { type: 'video', src: '/wa-templates/publica-video.mp4', poster: '/wa-templates/publica-video-poster.jpg' };

export const TEMPLATE_LOOK = {
  // "¡por fin llegó!" set (2026-11-03, Roland's text): one body, four formats
  cl_porfin_texto: { ...PORFIN, format: 'Text' },
  cl_porfin_gif_mascota: { ...PORFIN, format: 'GIF', header: { type: 'gif', src: '/wa-templates/porfin-mascota.mp4' } },
  cl_porfin_gif_estadisticas: { ...PORFIN, format: 'GIF', header: { type: 'gif', src: '/wa-templates/porfin-estadisticas.mp4' } },
  cl_porfin_video: { ...PORFIN, format: 'Video', header: { type: 'video', src: '/wa-templates/publica-video.mp4', poster: '/wa-templates/publica-video-poster.jpg' } },
  cl_publica_texto_v2: { ...V2, format: 'Text', buttons: ['Publicar gratis'], en: en('texto', 'Casa-Libre', ['List for free']) },
  cl_publica_gif_v2: { ...V2, format: 'GIF', header: GIF, buttons: ['Publicar gratis'], en: en('gif', 'Casa-Libre', ['List for free']) },
  cl_publica_imagen_v2: { ...V2, format: 'Image', header: IMG, buttons: ['Ver Casa-Libre'], en: en('imagen', 'Casa-Libre', ['See Casa-Libre']) },
  cl_publica_video_v2: { ...V2, format: 'Video', header: VID, buttons: ['Empezar ahora'], en: en('video', 'Casa-Libre', ['Get started']) },
  // the first set (before "Casa-Libre" was approved): same media and buttons
  cl_publica_texto: { ...V1, format: 'Text', buttons: ['Publicar gratis'], en: en('texto', 'Casa Libre', ['List for free']) },
  cl_publica_gif: { ...V1, format: 'GIF', header: GIF, buttons: ['Publicar gratis'], en: en('gif', 'Casa Libre', ['List for free']) },
  cl_publica_imagen: { ...V1, format: 'Image', header: IMG, buttons: ['Ver Casa Libre'], en: en('imagen', 'Casa Libre', ['See Casa Libre']) },
  cl_publica_video: { ...V1, format: 'Video', header: VID, buttons: ['Empezar ahora'], en: en('video', 'Casa Libre', ['Get started']) },
};

const FORMAT = { image: 'Image', video: 'Video', gif: 'GIF', document: 'Document', text: 'Text' };
export const SAMPLE_NAME = 'María';

// A body variable's sample: the contact's name → "María", fixed text → that text, else {{n}}.
function sampleFor(source, n) {
  const s = typeof source === 'string' ? source : source?.source;
  if (/first_name|(^|\.)name$/.test(String(s || ''))) return SAMPLE_NAME;
  if (source && typeof source === 'object' && source.text) return String(source.text);
  return `{{${n}}}`;
}
const fill = (body, vars) => {
  const bodyVars = Array.isArray(vars?.body) ? vars.body : [];
  return String(body || '').replace(/\{\{(\d+)\}\}/g, (_, n) => sampleFor(bodyVars[Number(n) - 1] ?? (n === '1' ? 'contact.first_name' : null), n));
};

// → { format, header: { type, src, poster } | null, body, footer, buttons: [label], url, translated }
// tpl = the Relay template ({ name, body, header, variables }) — may be missing (Relay down).
// vars = the batch's variables ({ body: [source…] }), to fill {{n}} the way that batch did.
// lang 'en': the English text when it is known here, else body null (translated: false) — the
// caller translates the Spanish one.
export function templateLook(name, tpl = null, vars = null, lang = 'es') {
  const look = TEMPLATE_LOOK[name] || {};
  const hType = look.header?.type || (tpl?.header ? String(tpl.header).toLowerCase() : null);
  const nButtons = Array.isArray(tpl?.variables?.url_buttons) ? tpl.variables.url_buttons.length : 0;
  const esButtons = look.buttons || Array.from({ length: nButtons }, () => 'Abrir enlace');
  const english = lang === 'en';
  return {
    format: look.format || FORMAT[hType] || 'Text',
    header: hType ? { type: hType, src: look.header?.src || null, poster: look.header?.poster || null } : null,
    body: english ? (look.en ? fill(look.en.body, vars) : null) : fill(tpl?.body, vars),
    footer: look.footer || null,
    buttons: english ? (look.en?.buttons || esButtons.map(() => 'Open link')) : esButtons,
    url: look.url || null,
    translated: english ? !!look.en : true,
  };
}

// WhatsApp formatting → segments: *bold*, _italic_, ~strike~, ```mono```.
export function waSegments(text = '') {
  const out = [];
  const re = /```([\s\S]+?)```|\*([^*\n]+)\*|_([^_\n]+)_|~([^~\n]+)~/g;
  let last = 0; let m;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    if (m[1] != null) out.push({ text: m[1], mono: true });
    else if (m[2] != null) out.push({ text: m[2], bold: true });
    else if (m[3] != null) out.push({ text: m[3], italic: true });
    else out.push({ text: m[4], strike: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
