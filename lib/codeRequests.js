// WhatsApp numbers that asked THIS site for a code (the "site-xx" flag every code request puts
// on the conversation — website lib/relay.js; older chats were flagged once from the sites'
// records) and whether they became users here. The ones that didn't: asked for a sign-up
// code and never finished — people to follow up. Pure — test/inboxPaywall.test.js.
import { SITE_TAG } from './inboxRules.js';

const key8 = (p) => String(p || '').replace(/\D/g, '').slice(-8);

// conversations: Relay's (with tags) · userPhones: this site's users.phone values
// → { asked, converted, notConverted: [{ phone, name, at, failed }] } (newest first)
export function codeRequestFunnel(conversations = [], userPhones = [], cc = 'py') {
  const users = new Set(userPhones.map(key8).filter((k) => k.length === 8));
  const asked = conversations.filter((c) => (c.tags || []).includes(`${SITE_TAG}${cc}`));
  const notConverted = asked.filter((c) => !users.has(key8(c.phone)))
    .map((c) => ({ phone: c.phone, name: c.name || null, at: c.last_message?.created_at || null, failed: c.last_message?.direction === 'outbound' && c.last_message?.status === 'failed', wrote: !!c.last_inbound_at }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
  return { asked: asked.length, converted: asked.length - notConverted.length, notConverted };
}
