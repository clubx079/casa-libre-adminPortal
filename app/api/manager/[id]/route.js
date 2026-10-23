// GET   /api/manager/:id → one report: status + live log while running; report, drafts,
//                          the admins' feedback and the data it was built on when done.
// PATCH /api/manager/:id → { op, … }
//   op 'edit'     { actionId, subject?, heading?, body?, button_label?, button_url? }
//   op 'dismiss'  { actionId }      op 'restore' { actionId }
//   op 'send'     { actionId }      → emails the person (lib/manager/send.js)
//   op 'feedback' { item, vote: 'up'|'down'|null, note? } → read by next week's run
//   op 'compose'  { source: 'claim'|'suspicious', index } → a draft email for an item the report
//                 did not draft for (false flag, unclear, flagged listing), into the review queue
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError } from '@/lib/automationDb';
import { countryInfo } from '@/lib/automationAdmin';
import { TABLE } from '@/lib/manager/run';
import crypto from 'node:crypto';
import { applyEdit, buildActions } from '@/lib/manager/actions';
import { composeDraft, factsFor } from '@/lib/manager/compose';
import { sendAction } from '@/lib/manager/send';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const q = encodeURIComponent;

export async function GET(_req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  try {
    const [row] = await dbFor(country).select(TABLE, `select=*&id=eq.${q(params.id)}&country=eq.${country}&limit=1`);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });
    return NextResponse.json({ report: row, site: countryInfo(country).site });
  } catch (e) { return dbError(e); }
}

export async function PATCH(req, { params }) {
  const session = getSession();
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const country = activeCountry();
  const db = dbFor(country);
  const body = await req.json().catch(() => ({}));
  const by = session.email || null;
  try {
    if (body.op === 'send') {
      const res = await sendAction(country, params.id, String(body.actionId || ''), by);
      if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status || 500 });
      return NextResponse.json({ ok: true, action: res.action });
    }

    const [row] = await db.select(TABLE, `select=id,actions,feedback&id=eq.${q(params.id)}&country=eq.${country}&limit=1`);
    if (!row) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (body.op === 'feedback') {
      const item = String(body.item || '').slice(0, 300);
      if (!item) return NextResponse.json({ error: 'item required' }, { status: 400 });
      const vote = body.vote === 'up' || body.vote === 'down' ? body.vote : null;
      const note = String(body.note || '').trim().slice(0, 1000);
      const feedback = { ...(row.feedback || {}) };
      if (!vote && !note) delete feedback[item];
      else feedback[item] = { item, vote, note, by, at: new Date().toISOString() };
      await db.update(TABLE, `id=eq.${q(params.id)}`, { feedback }, { returning: 'minimal' });
      return NextResponse.json({ ok: true, feedback });
    }

    if (body.op === 'compose') {
      const [full] = await db.select(TABLE, `select=report,data_pack,actions&id=eq.${q(params.id)}&limit=1`);
      const list = body.source === 'suspicious' ? full?.report?.suspicious : full?.report?.claim_checks;
      const item = (list || [])[Number(body.index)];
      if (!item) return NextResponse.json({ error: 'item_not_found' }, { status: 404 });
      const site = countryInfo(country).site;
      const { draft, via, error } = await composeDraft({ country, site, item, facts: factsFor(full.data_pack || {}, item) });
      const { actions: made, dropped } = buildActions([{ ...draft, user_id: item.user_id || draft.user_id, feedback_id: item.feedback_id || draft.feedback_id, property_id: item.property_id || draft.property_id }], { site, newId: () => crypto.randomUUID() });
      if (!made.length) return NextResponse.json({ error: 'cannot_draft', message: dropped[0]?.reason || 'No one to send this to (no account or email).' }, { status: 400 });
      const action = { ...made[0], requested_by: by, requested_at: new Date().toISOString(), from: { source: body.source === 'suspicious' ? 'suspicious' : 'claim', index: Number(body.index) }, via };
      await db.update(TABLE, `id=eq.${q(params.id)}`, { actions: [...(full.actions || []), action] }, { returning: 'minimal' });
      return NextResponse.json({ ok: true, action, via, error: error || null });
    }

    const actions = row.actions || [];
    const i = actions.findIndex((a) => a.id === body.actionId);
    if (i < 0) return NextResponse.json({ error: 'draft_not_found' }, { status: 404 });
    const a = actions[i];
    if (a.status === 'sent') return NextResponse.json({ error: 'already_sent' }, { status: 409 });
    let next;
    if (body.op === 'edit') {
      const v = applyEdit(a, body, countryInfo(country).site);
      if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
      next = { ...v.action, edited_by: by, edited_at: new Date().toISOString() };
    } else if (body.op === 'dismiss') next = { ...a, status: 'dismissed', dismissed_by: by, dismissed_at: new Date().toISOString() };
    else if (body.op === 'restore') next = { ...a, status: 'draft' };
    else return NextResponse.json({ error: 'unknown op' }, { status: 400 });
    const list = actions.map((x, k) => (k === i ? next : x));
    await db.update(TABLE, `id=eq.${q(params.id)}`, { actions: list }, { returning: 'minimal' });
    return NextResponse.json({ ok: true, action: next });
  } catch (e) { return dbError(e); }
}
