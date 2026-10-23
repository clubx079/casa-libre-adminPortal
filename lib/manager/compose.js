// Admin Manager — "Draft an email" on one checked item (a false flag, an unclear claim, a
// suspicious listing). The weekly run never drafts for those; an admin can still ask for one
// from the report. One short Claude call with the same voice rules as the weekly drafts and
// the facts the code collected about that person; if Claude can't be reached, a plain
// editable starter so the admin can write it themselves. The result joins the report's
// review queue as a normal draft (edit → Approve & send). Server-only.
import Anthropic from '@anthropic-ai/sdk';
import { systemPrompt, DRAFT_SCHEMA } from './prompt.js';
import { MODEL, parseReport } from './agent.js';

// The facts the data pack holds about this item (claimChecks / suspicious listing).
export function factsFor(pack = {}, item = {}) {
  const claim = (pack.claimChecks?.items || []).find((c) => (item.feedback_id && String(c.feedback_id) === String(item.feedback_id)) || (item.user_id && String(c.user_id) === String(item.user_id)));
  const listing = (pack.suspicious?.listingsWithImpossibleData || []).find((l) => item.property_id && l.property_id === item.property_id);
  return { claim: claim || null, listing: listing || null };
}

// A starter the admin edits when Claude is unavailable.
export function starterDraft(item = {}, site) {
  const listing = !!item.property_id;
  return {
    kind: listing ? 'listing_fix' : 'other',
    user_id: item.user_id || null,
    feedback_id: item.feedback_id || null,
    property_id: item.property_id || null,
    reason: item.title || item.who || 'Written by an admin',
    evidence: item.reason || '',
    subject: listing ? 'Un detalle en tu publicación' : 'Sobre tu mensaje a Casa Libre',
    heading: listing ? 'Revisemos tu publicación' : 'Gracias por escribirnos',
    body: 'Hola,\n\n[Escribí acá el mensaje]\n\nEl equipo de Casa Libre',
    button_label: listing ? 'Ver mis publicaciones' : null,
    button_url: listing ? `${site}/cuenta/publicaciones` : null,
  };
}

// item: the checked row (claim_checks / suspicious entry); facts: factsFor(); → { draft, via }
export async function composeDraft({ country, site, item, facts }) {
  if (!process.env.ANTHROPIC_API_KEY) return { draft: starterDraft(item, site), via: 'starter' };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 120000, maxRetries: 2 });
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      system: systemPrompt(country),
      output_config: { effort: 'low', format: { type: 'json_schema', schema: DRAFT_SCHEMA } },
      messages: [{
        role: 'user',
        content: `An admin asked for ONE personal email about this item from the weekly report. The report judged it as shown; write the email that fits the facts (for a false flag: kind, never accusing, explain what we can see — e.g. the listing was never finished and no payment reached us — and how to finish or get help; for a listing with wrong data: say exactly what to fix). Follow the email style and link rules. Use the person's ids from the item.\n\nItem:\n${JSON.stringify(item)}\n\nFacts from our records:\n${JSON.stringify(facts)}`,
      }],
    });
    return { draft: parseReport(msg), via: 'claude' };
  } catch (e) {
    return { draft: starterDraft(item, site), via: 'starter', error: String(e?.message || e).slice(0, 200) };
  }
}
