// POST /api/seo/action — Admin → SEO buttons, for the active country. Every change goes through the
// Check guardrails and is logged in seo_changes (lib/seo/actions.js).
//   { action: 'apply' | 'dismiss', id }                       an opportunity
//   { action: 'approve' | 'reject' | 'regenerate', id }       a draft ('regenerate' = with Claude)
//   { action: 'edit_draft', id, patch: { title, h1, description, answer, sections, faq } }
//   { action: 'revert', id }                                  a change
//   { action: 'set_title', path, title } | { action: 'enable_variant' | 'retire_variant' | 'add_links', path }
//   { action: 'settings', settings }
//   { action: 'run', job: 'collect' | 'decide' | 'improve' }
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { activeCountry } from '@/lib/adminCountry';
import { ccOf, saveSettings, isMissingTable } from '@/lib/seo/store';
import * as A from '@/lib/seo/actions';
import { runCollect, runDecide, runImprove } from '@/lib/seo/run';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(req) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const cc = ccOf(activeCountry());
  const by = session.email || session.name || 'admin';
  let body = {};
  try { body = await req.json(); } catch { /* empty */ }
  const { action, id, path } = body;
  try {
    let result;
    switch (action) {
      case 'apply': result = await A.applyOpportunity(cc, id, { by }); break;
      case 'dismiss': result = await A.dismissOpportunity(cc, id, { by }); break;
      case 'approve': result = await A.approveDraft(cc, id, { by }); break;
      case 'reject': result = await A.rejectDraft(cc, id, { by }); break;
      case 'regenerate': result = await A.regenerateDraft(cc, id, { by }); break;
      case 'edit_draft': result = await A.updateDraft(cc, id, body.patch || {}); break;
      case 'revert': result = await A.revertChange(cc, id, { by }); break;
      case 'set_title': result = await A.setTitle(cc, path, body.title, { by, reason: body.reason || 'set by hand' }); break;
      case 'enable_variant': result = await A.enableVariant(cc, path, { by }); break;
      case 'retire_variant': result = await A.retireVariant(cc, path, { by }); break;
      case 'add_links': result = await A.addLinks(cc, path, { by, reason: body.reason || 'strengthen by hand' }); break;
      case 'settings': result = { settings: await saveSettings(cc, body.settings, by) }; break;
      case 'run':
        if (body.job === 'collect') result = { collect: await runCollect(cc, body.only || null) };
        else if (body.job === 'decide') result = { decide: await runDecide(cc) };
        else if (body.job === 'improve') result = { improve: await runImprove(cc, { by }) };
        else return NextResponse.json({ error: 'unknown job' }, { status: 400 });
        break;
      default: return NextResponse.json({ error: 'unknown action' }, { status: 400 });
    }
    return NextResponse.json({ ok: true, country: cc, ...result });
  } catch (e) {
    if (isMissingTable(e)) return NextResponse.json({ error: 'Run migrations/011_seo_pipeline.sql on this country DB first.' }, { status: 409 });
    return NextResponse.json({ error: String(e?.message || e).slice(0, 300) }, { status: e?.status || 500 });
  }
}
