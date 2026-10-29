// POST /api/inbox/ai?mode= { phone, instruction?, draft? } → { message, english, note, context }
// The inbox's AI reply: Claude reads the conversation plus a fact sheet about THIS person on
// the site their number came from (lib/aiContext.js — read-only, only their own rows: account,
// listings and their state, unfinished drafts, paid-listing state, messages we already sent, and
// that site's links) and writes the next WhatsApp message in the contact's language, with an
// English version for the team. `instruction` = what the admin wants to say, in any language;
// `draft` = a text to improve. The admin always reviews and sends it — nothing is sent here.
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';
import { threadForAi } from '@/lib/inboxRules';
import { loadFactSheet, siteFor } from '@/lib/aiContext';
import { activeCountry, canAccessCountry } from '@/lib/adminCountry';
import { MODEL, SCHEMA, systemPrompt, buildAsk, AI_SETTINGS } from '@/lib/aiPrompt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// One line for the panel: what the AI knew.
const contextLine = (f) => [
  f.site.country,
  f.account ? (f.account.name || 'account') : 'no account',
  f.account ? `${f.listings.length} ${f.listings.length === 1 ? 'listing' : 'listings'}` : '',
  f.drafts.length ? `${f.drafts.length} unfinished ${f.drafts.length === 1 ? 'draft' : 'drafts'}` : '',
].filter(Boolean).join(' · ');

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const factsOnly = new URL(req.url).searchParams.get('facts') === '1';
  if (!process.env.ANTHROPIC_API_KEY && !factsOnly) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set in the admin env.' }, { status: 503 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const b = await req.json().catch(() => ({}));
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  if (phone.length < 8) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  const [conv, msgs] = await Promise.all([
    relay(mode, `/conversations/${phoneParam(phone)}`),
    relay(mode, `/conversations/${phoneParam(phone)}/messages?limit=40`),
  ]);
  if (!msgs.ok) return NextResponse.json({ error: msgs.data?.error?.message || 'Could not read the conversation.' }, { status: msgs.status });
  const cc = siteFor(conv.ok ? conv.data : null, activeCountry());
  if (!canAccessCountry(cc)) return NextResponse.json({ error: 'This conversation belongs to a country you can\'t access.' }, { status: 403 });
  const facts = await loadFactSheet(phone, conv.ok ? conv.data : null, activeCountry());
  // ?facts=1 → only what the assistant would know (no Claude call) — to check / debug
  if (new URL(req.url).searchParams.get('facts') === '1') return NextResponse.json({ facts, context: contextLine(facts) });
  const thread = threadForAi([...(msgs.data.data || [])].reverse());
  const ask = buildAsk({ thread, facts, whatsappName: conv.ok ? conv.data.name || null : null, windowOpen: conv.ok ? !!conv.data.window?.open : null, instruction: b.instruction, draft: b.draft });
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90000, maxRetries: 2 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: AI_SETTINGS.max_tokens,
      system: systemPrompt(facts.site.country),
      output_config: { effort: AI_SETTINGS.effort, format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: ask }],
    });
    const text = (msg.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
    const out = JSON.parse(text);
    return NextResponse.json({ message: String(out.message || ''), english: String(out.english || ''), note: String(out.note || ''), context: contextLine(facts), situation: facts.situation, usage: msg.usage ? { input: msg.usage.input_tokens, output: msg.usage.output_tokens, cache_read: msg.usage.cache_read_input_tokens || 0 } : null, windowOpen: conv.ok ? !!conv.data.window?.open : null });
  } catch (e) {
    return NextResponse.json({ error: `Claude couldn't write it: ${String(e?.message || e).slice(0, 200)}` }, { status: 502 });
  }
}
