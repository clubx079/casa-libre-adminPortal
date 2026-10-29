// GET /api/users/code-requests → for the active country: how many WhatsApp numbers asked this
// site for a code, how many became users, and the ones that didn't (lib/codeRequests.js) —
// from the live WhatsApp inbox (Relay) and this country's users.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { selectAll } from '@/lib/selectAll';
import { allConversations } from '@/lib/inboxData';
import { codeRequestFunnel } from '@/lib/codeRequests';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const cc = activeCountry();
  try {
    const [convs, users] = await Promise.all([
      allConversations('live'),
      selectAll(dbFor(cc), 'users', 'select=id,phone&phone=not.is.null&order=id.asc'),
    ]);
    return NextResponse.json({ country: cc, ...codeRequestFunnel(convs, users.map((u) => u.phone), cc) });
  } catch (e) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 200) }, { status: 500 });
  }
}
