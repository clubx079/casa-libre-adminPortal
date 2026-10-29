// GET /api/inbox/conversations?mode=live|test&status=open|done|all&view=all|unread|unresponded|window
//                             &country=<code>|all&q=
// → the conversations of the chosen country (default: the admin's active country), with
// Unread (Relay's count or "marked unread"), Unresponded (the contact wrote last) and 24h
// window open (we can still send free text) worked out here (lib/inboxRules.js), plus counts for every filter and per country. Admin only.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { modeOf, inboxModes } from '@/lib/relayInbox';
import { activeCountry } from '@/lib/adminCountry';
import { conversationsWithCountry } from '@/lib/inboxData';
import { filterConversations, countryCounts, visibleTags, isUnread, isMarkedUnread, isUnresponded, dncOf, windowHoursLeft } from '@/lib/inboxRules';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const mode = modeOf(sp.get('mode'));
  const status = ['open', 'done', 'all'].includes(sp.get('status')) ? sp.get('status') : 'open';
  const view = ['all', 'unread', 'unresponded', 'window'].includes(sp.get('view')) ? sp.get('view') : 'all';
  const country = sp.get('country') === 'all' ? 'all' : /^[a-z]{2,5}$/.test(sp.get('country') || '') ? sp.get('country') : activeCountry();
  try {
    const all = await conversationsWithCountry(mode, { fresh: sp.get('fresh') === '1' });
    const { data, counts } = filterConversations(all, { status, view, country, q: (sp.get('q') || '').slice(0, 80) });
    return NextResponse.json({
      data: data.slice(0, 300).map((c) => ({
        ...c, tags: visibleTags(c.tags), unread: isUnread(c), marked_unread: isMarkedUnread(c), unresponded: isUnresponded(c), dnc: dncOf(c), window_hours_left: windowHoursLeft(c),
      })),
      counts, byCountry: countryCounts(all), country, modes: inboxModes(),
    });
  } catch (e) {
    return NextResponse.json({ ...(e.data || {}), error: e.data?.error || { message: String(e.message || e) }, modes: inboxModes() }, { status: e.status || 500 });
  }
}
