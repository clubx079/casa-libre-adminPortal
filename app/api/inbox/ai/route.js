// POST /api/inbox/ai?mode= { phone, instruction?, draft? } → { message, english, note }
// The inbox's AI reply: Claude reads the conversation (and who the person is on Casa Libre)
// and writes the next WhatsApp message in the contact's language (Spanish by default), with an
// English version so the team knows what it says. `instruction` = what the admin wants to say,
// in any language ("tell her we'll check the photos today"); `draft` = a text to improve.
// The admin always reviews and sends it — nothing is sent from here.
import { NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';
import { withSites } from '@/lib/inboxData';
import { threadForAi } from '@/lib/inboxRules';
import { contactFor } from '@/lib/inboxContact';
import { canAccessCountry } from '@/lib/adminCountry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const MODEL = process.env.INBOX_AI_MODEL || 'claude-opus-5-5';
const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    message: { type: 'string', description: 'The WhatsApp message to send, in the contact\'s language.' },
    english: { type: 'string', description: 'The same message in English, for the team.' },
    note: { type: 'string', description: 'One short tip for the team in English (e.g. "they asked not to be contacted — consider Do not contact"), or empty.' },
  },
  required: ['message', 'english', 'note'],
};

const system = (country) => `You write WhatsApp replies for the Casa Libre team. Casa Libre (casa-libre.com.py and sister sites) is a property marketplace in ${COUNTRY_NAME[country] || 'Latin America'}: owners and agencies publish houses, apartments and land for sale or rent; buyers contact sellers directly on WhatsApp. A few listings a month are free; extra ones are paid. Many of our messages to people are automatic (templates about their listing or draft).

Write the NEXT message from Casa Libre in this conversation.
- Language: the one the contact writes in; Spanish (with "vos", as spoken in ${COUNTRY_NAME[country] || 'the region'}) when unsure.
- WhatsApp style: short (1–4 sentences), warm, clear, no long greetings, no signature, at most one emoji.
- Answer what they asked. If we have nothing to answer, keep the conversation open with something useful (e.g. offer help finishing their listing).
- Never invent facts (prices, dates, calls, refunds, features). If the team didn't say it and the conversation doesn't show it, don't promise it.
- If they are rude, not interested or ask us to stop: a short polite closing, and say so in "note".
- Follow the team's instruction when there is one; it is about WHAT to say — you still write it well, in the contact's language.
Return JSON only.`;

export async function POST(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set in the admin env.' }, { status: 503 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const b = await req.json().catch(() => ({}));
  const phone = String(b.phone || '').replace(/[^\d]/g, '');
  if (phone.length < 8) return NextResponse.json({ error: 'invalid_phone' }, { status: 400 });
  const [conv, msgs] = await Promise.all([
    relay(mode, `/conversations/${phoneParam(phone)}`),
    relay(mode, `/conversations/${phoneParam(phone)}/messages?limit=40`),
  ]);
  if (!msgs.ok) return NextResponse.json({ error: msgs.data?.error?.message || 'Could not read the conversation.' }, { status: msgs.status });
  const country = conv.ok ? (await withSites(conv.data)).country : 'none';   // the site the number came from
  const who = canAccessCountry(country) ? await contactFor(phone, country).catch(() => null) : null;
  const thread = threadForAi([...(msgs.data.data || [])].reverse());
  const facts = {
    whatsapp_name: conv.ok ? conv.data.name || null : null,
    casa_libre_account: who ? { name: who.user.name, listings: who.listings, live_listings: who.live, waiting_for_payment: who.waitingPayment, joined: String(who.user.joined || '').slice(0, 10) } : 'not found',
    reply_window_open: conv.ok ? !!conv.data.window?.open : null,
  };
  const ask = [
    `Conversation (oldest first):\n${thread || '(no messages yet)'}`,
    `Facts from our records: ${JSON.stringify(facts)}`,
    b.instruction ? `The team's instruction: ${String(b.instruction).slice(0, 1000)}` : 'No instruction: write the best next message.',
    b.draft ? `The team's draft to improve (keep its meaning): ${String(b.draft).slice(0, 2000)}` : '',
  ].filter(Boolean).join('\n\n');
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 90000, maxRetries: 2 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 1500,
      system: system(country),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
      messages: [{ role: 'user', content: ask }],
    });
    const text = (msg.content || []).filter((x) => x.type === 'text').map((x) => x.text).join('').trim();
    const out = JSON.parse(text);
    return NextResponse.json({ message: String(out.message || ''), english: String(out.english || ''), note: String(out.note || ''), windowOpen: facts.reply_window_open });
  } catch (e) {
    return NextResponse.json({ error: `Claude couldn't write it: ${String(e?.message || e).slice(0, 200)}` }, { status: 502 });
  }
}
