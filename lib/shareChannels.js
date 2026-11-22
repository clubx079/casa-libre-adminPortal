// "Share your listing" channels — the codes in share links (<origin>/l/<code>?c=<channel>) and the
// names the redirect puts in utm_source (contract shared with the website and the app).
// The admin reads both (a share sheet event carries the code, a landing visit the utm_source
// name), so channelOf() takes either and answers the code. Pure — test/shareStats.test.js.
export const SHARE_CHANNELS = [
  { code: 'wa', name: 'whatsapp', label: 'WhatsApp' },
  { code: 'fb', name: 'facebook', label: 'Facebook' },
  { code: 'ig', name: 'instagram', label: 'Instagram' },
  { code: 'tt', name: 'tiktok', label: 'TikTok' },
  { code: 'x', name: 'x', label: 'X (Twitter)' },
  { code: 'li', name: 'linkedin', label: 'LinkedIn' },
  { code: 'copy', name: 'copy', label: 'Copied link' },
  { code: 'qr', name: 'qr', label: 'QR code' },
];
const BY = new Map();
for (const c of SHARE_CHANNELS) for (const k of [c.code, c.name, c.label.toLowerCase()]) BY.set(k, c);
// a few spellings the clients might send
for (const [k, code] of [['twitter', 'x'], ['copy_link', 'copy'], ['copylink', 'copy'], ['link', 'copy'], ['qrcode', 'qr'], ['qr_code', 'qr'], ['wa.me', 'wa'], ['face', 'fb']]) BY.set(k, BY.get(code));

// 'instagram' | 'ig' | 'Instagram' → 'ig'; anything else → 'other' (empty → 'other').
export function channelOf(v) {
  const k = String(v ?? '').trim().toLowerCase();
  return BY.get(k)?.code || 'other';
}
export const channelLabel = (code) => (code === 'other' ? 'Other / unknown' : SHARE_CHANNELS.find((c) => c.code === code)?.label || code);
export const CHANNEL_ORDER = [...SHARE_CHANNELS.map((c) => c.code), 'other'];

// The events (website + app share sheet; the /l/<code> redirect records the click server-side).
export const SHARE_EVENTS = { opened: 'listing_share_opened', shared: 'listing_shared', click: 'share_link_click' };
export const SHARE_MEDIUM = 'share';
export const SHARE_CAMPAIGN = 'listing_share';
