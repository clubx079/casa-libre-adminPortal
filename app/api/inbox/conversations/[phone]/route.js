// GET   /api/inbox/conversations/:phone?mode= → one conversation (name, tags, 24h window,
//        + unread / unresponded / do-not-contact and the person's country)
// PATCH /api/inbox/conversations/:phone?mode= { status: 'open'|'done', add_tags, remove_tags,
//        unread: true|false, dnc: { on, note } }
//   unread true  = "Mark as unread": the red dot comes back until someone opens it again
//   dnc          = "Do not contact" + a short note (tags shared with Relay's inbox)
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { relay, modeOf, phoneParam } from '@/lib/relayInbox';
import { forgetConversations, countryPrefixes } from '@/lib/inboxData';
import { UNREAD_TAG, visibleTags, isUnread, isMarkedUnread, isUnresponded, dncOf, dncTagPatch, isInternalTag, countryOf } from '@/lib/inboxRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const shape = async (c) => ({ ...c, tags: visibleTags(c.tags), unread: isUnread(c), marked_unread: isMarkedUnread(c), unresponded: isUnresponded(c), dnc: dncOf(c), country: countryOf(c.phone, await countryPrefixes()) });

export async function GET(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const r = await relay(mode, `/conversations/${phoneParam(params.phone)}`);
  return NextResponse.json(r.ok ? await shape(r.data) : r.data, { status: r.ok ? 200 : r.status });
}

export async function PATCH(req, { params }) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const mode = modeOf(new URL(req.url).searchParams.get('mode'));
  const b = await req.json().catch(() => ({}));
  const add = [], remove = [];
  const json = {};
  if (['open', 'done'].includes(b.status)) json.status = b.status;
  // free tags from the "+ Tag" button — never the internal ones
  for (const [k, into] of [['add_tags', add], ['remove_tags', remove]]) {
    if (Array.isArray(b[k])) into.push(...b[k].map((t) => String(t).trim().slice(0, 40)).filter((t) => t && !isInternalTag(t)));
  }
  if (b.unread === true) add.push(UNREAD_TAG);
  if (b.unread === false) remove.push(UNREAD_TAG);
  if (b.dnc && typeof b.dnc === 'object') {
    const cur = await relay(mode, `/conversations/${phoneParam(params.phone)}`);
    if (!cur.ok) return NextResponse.json(cur.data, { status: cur.status });
    const p = dncTagPatch(cur.data, !!b.dnc.on, b.dnc.note);
    add.push(...(p.add_tags || [])); remove.push(...(p.remove_tags || []));
  }
  if (add.length) json.add_tags = [...new Set(add)].slice(0, 10);
  if (remove.length) json.remove_tags = [...new Set(remove)].slice(0, 10);
  if (!Object.keys(json).length) return NextResponse.json({ error: { code: 'nothing_to_change' } }, { status: 400 });
  const r = await relay(mode, `/conversations/${phoneParam(params.phone)}`, { method: 'PATCH', json });
  forgetConversations(mode);
  return NextResponse.json(r.ok ? await shape(r.data) : r.data, { status: r.ok ? 200 : r.status });
}
