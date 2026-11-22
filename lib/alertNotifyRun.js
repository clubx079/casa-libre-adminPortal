// Alerts → email, the I/O side of lib/alertNotify.js. Called:
//   • every time the alerts are computed (lib/alertsData.js — the Alerts page and the sidebar
//     badge, so within seconds of an admin opening the admin), in the background;
//   • by the hourly security cron (/api/cron/security?country=…), so it also runs when nobody
//     has the admin open.
// Exactly once per alert: the claim is an email_log row (automation 'alert_notify', unique
// dedupe_key alert-notify:<alert id>) inserted BEFORE sending, plus the mark in the state row.
// One run at a time per country (in-process lock). dryRun: decide only, send / write nothing.
import 'server-only';
import { dbFor } from './db';
import { sendTeamAlertEmail } from './email';
import { countryInfo } from './automationAdmin';
import { appBaseUrl } from './appUrl';
import { toEnglishMany } from './issueTranslate';
import { ALERT_NOTIFY_ID, alertsToNotify, alertEmail, alertRecipients, readNotifyState } from './alertNotify';

const running = (globalThis.__clAlertNotify ||= new Map());
const isDup = (e) => e?.status === 409 || e?.code === '23505' || /duplicate|23505|409/.test(String(e?.message || ''));

async function saveState(db, row, state) {
  const p = { enabled: false, free_tiers: [state], updated_at: new Date().toISOString() };
  if (row) await db.update('automations', `id=eq.${ALERT_NOTIFY_ID}`, p, { returning: 'minimal' });
  else await db.insert('automations', [{ id: ALERT_NOTIFY_ID, wait_days: 0, ...p }], { returning: 'minimal' });
}

export function notifyNewAlerts(country, alerts, opts = {}) {
  const key = country;
  if (running.has(key)) return running.get(key);
  const p = run(country, alerts, opts).finally(() => running.delete(key));
  running.set(key, p);
  return p;
}

async function run(country, alerts, { dryRun = false, db = dbFor(country), send = sendTeamAlertEmail, now = Date.now() } = {}) {
  if (process.env.ALERT_EMAILS === '0') return { skipped: 'off' };
  const [row] = await db.select('automations', `select=id,free_tiers&id=eq.${ALERT_NOTIFY_ID}&limit=1`).catch(() => []);
  const state = readNotifyState(row || null);
  const plan = alertsToNotify({ alerts, state, now });
  const to = alertRecipients(process.env.ALERT_EMAIL_TO, state.to);
  const out = { seeded: plan.seed ? alerts.length : 0, due: plan.toSend.map((a) => a.id), sent: [], failed: [], to, dryRun };
  if (dryRun) return out;
  if (plan.seed) { await saveState(db, row, plan.state); return out; }
  if (!plan.toSend.length) {
    if (Object.keys(plan.state.sent).length !== Object.keys(state.sent).length) await saveState(db, row, plan.state);
    return out;
  }
  const { countryName } = countryInfo(country);
  const texts = plan.toSend.flatMap((a) => (a.wrote || []).slice(0, 4));
  const en = await Promise.race([toEnglishMany(texts), new Promise((r) => setTimeout(() => r(new Map()), 8000))]).catch(() => new Map());
  const next = { ...plan.state, sent: { ...plan.state.sent } };
  for (const a of plan.toSend) {
    const msg = alertEmail(a, { adminUrl: appBaseUrl(), countryName, wroteEn: (a.wrote || []).slice(0, 4).map((w) => en.get?.(String(w).trim()) || '') });
    let log;
    try {
      [log] = await db.insert('email_log', [{ automation_id: 'alert_notify', template_key: `alert-${a.type}`, to_email: to.join(', '), subject: msg.subject, status: 'sending', dedupe_key: `alert-notify:${a.id}` }]);
    } catch (e) {
      if (isDup(e)) { next.sent[a.id] = new Date(now).toISOString(); continue; }   // already emailed
      out.failed.push(a.id); continue;
    }
    const res = await send({ country, to, ...msg }).catch((e) => ({ ok: false, error: e?.message }));
    if (!res?.ok) {
      await db.remove('email_log', `id=eq.${encodeURIComponent(log.id)}`).catch(() => {});
      out.failed.push(a.id);
      continue;
    }
    await db.update('email_log', `id=eq.${encodeURIComponent(log.id)}`, { status: 'sent', resend_id: res.id || null }, { returning: 'minimal' }).catch(() => {});
    next.sent[a.id] = new Date(now).toISOString();
    out.sent.push(a.id);
  }
  await saveState(db, row, next);
  return out;
}
