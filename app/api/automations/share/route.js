// GET /api/automations/share → the "Share nudges" and "Share reward" cards of the Automations page
//     (lib/shareAdmin.js): settings, the templates to pick from, emails sent, rewards granted.
// PUT { id: 'share_nudge' | 'share_reward', … } → save one card (the first save creates its row and
//     default Spanish emails; the reward stays OFF until switched on). Active country.
import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { dbFor } from '@/lib/db';
import { activeCountry } from '@/lib/adminCountry';
import { dbError, EMAIL_ONLY } from '@/lib/automationDb';
import { SHARE_NUDGE_ID, SHARE_REWARD_ID, shareNudgeConfig, shareRewardConfig, shareNudgeCounts, saveShareNudge, saveShareReward } from '@/lib/shareAdmin';
import { summarizeShareRewards } from '@/lib/shareStats';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function payload(db) {
  const [rows, templates, nudgeLogs, rewardLogs] = await Promise.all([
    db.select('automations', `select=*&id=in.(${SHARE_NUDGE_ID},${SHARE_REWARD_ID})`).catch(() => []),
    db.select('email_templates', 'select=id,key,name,subject,is_active&order=created_at.asc'),
    db.select('email_log', `select=template_key,template_id&automation_id=eq.${SHARE_NUDGE_ID}&status=in.(sent,delivered,read)&order=created_at.desc&limit=20000&${EMAIL_ONLY}`).catch(() => []),
    db.select('email_log', `select=id,status,channel,dedupe_key,subject,created_at&automation_id=eq.${SHARE_REWARD_ID}&order=created_at.desc&limit=20000`).catch(() => []),
  ]);
  const nudge = shareNudgeConfig(rows.find((r) => r.id === SHARE_NUDGE_ID) || null);
  const reward = shareRewardConfig(rows.find((r) => r.id === SHARE_REWARD_ID) || null);
  const granted = summarizeShareRewards(rewardLogs, { days: 30 });
  return {
    nudge: { settings: nudge, ...shareNudgeCounts(nudgeLogs, nudge) },
    reward: { settings: reward, granted: granted.total, grantedWeek: granted.w },
    templates,
    country: activeCountry(),
  };
}

export async function GET() {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  try { return NextResponse.json(await payload(dbFor(activeCountry()))); } catch (e) { return dbError(e); }
}

export async function PUT(req) {
  if (!getSession()) return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  const db = dbFor(activeCountry());
  const { id, ...body } = await req.json().catch(() => ({}));
  try {
    let v;
    if (id === SHARE_NUDGE_ID) v = await saveShareNudge(db, body);
    else if (id === SHARE_REWARD_ID) v = await saveShareReward(db, body);
    else return NextResponse.json({ error: 'unknown automation' }, { status: 400 });
    if (!v.ok) return NextResponse.json({ error: 'invalid', errors: v.errors }, { status: 400 });
    return NextResponse.json(await payload(db));
  } catch (e) { return dbError(e); }
}
