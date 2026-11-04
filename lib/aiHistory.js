// Everything we did with one person before this message, for the Inbox assistant's fact sheet —
// the same history as their "Messages & activity" timeline (Analytics → a user), as short lines,
// newest first: the AI's earlier answers and hand-overs, the team's Open-issue messages, the Admin
// Manager's emails, every automation email / WhatsApp, campaigns, and their feedback. No
// translation needed (Claude reads every language). Pure — test/aiHistory.test.js.
const day = (iso) => String(iso || '').slice(0, 10);
const cut = (s, n) => { const v = String(s || '').replace(/\s+/g, ' ').trim(); return v.length > n ? `${v.slice(0, n - 1)}…` : v; };
const meta = (r) => { try { return JSON.parse(r?.error || '{}') || {}; } catch { return {}; } };
const ch = (r) => (r.channel === 'whatsapp' ? 'WhatsApp' : 'email');
const STATUS = (s) => (['read', 'delivered', 'failed'].includes(s) ? ` [${s}]` : '');

// rows: email_log rows of this person (any automation); feedback: their feedback rows
export function historyLines({ rows = [], feedback = [], max = 40 } = {}) {
  const items = [];
  for (const r of rows) {
    const m = meta(r);
    const at = r.created_at;
    let line = null;
    switch (r.automation_id) {
      case 'inbox_ai':
        line = `AI assistant answered “${cut(m.question, 90)}” → “${cut(m.english, 140)}”${m.goal && m.goal !== 'none' ? ` (asked them to: ${m.goal})` : ''}`;
        break;
      case 'inbox_ai_person':
        line = `AI assistant passed it to a person (${cut(m.note || m.reason || r.subject, 100)}); they asked “${cut(m.question, 90)}”`;
        break;
      case 'open_issue':
        line = `Team (${m.by || 'admin'}) ${m.action === 'gift' ? 'published their waiting listings FREE as a gift' : `wrote by ${ch(r)}: “${cut(m.english || m.text, 140)}”`}`;
        break;
      case 'manager':
        line = `Admin Manager personal email: “${cut(r.subject, 100)}”`;
        break;
      case 'manager_views':
        line = `Admin Manager sent the price / photos advice by ${ch(r)} (${m.views ?? '?'} views, ${m.contacts ?? 0} contacts)`;
        break;
      case 'wa_campaign':
        if (r.channel === 'wa_campaign') continue;   // the batch itself, not a person's row
        line = `Campaign WhatsApp ${r.template_key || ''}${m.keyword ? ` — they tapped ${String(m.keyword).toUpperCase()}` : ''}`;
        break;
      case 'wa_reply':
        line = `They ${/optout/.test(String(r.template_key || '')) || r.template_key === 'baja' ? 'opted out of our WhatsApp messages' : `tapped ${String(r.template_key || '').toUpperCase()}`} (${r.subject || ''})`;
        break;
      case 'msg_kind': case 'event_listing_deleted':
        continue;
      default:
        if (!r.automation_id) continue;
        line = `Automation "${r.automation_id}" ${ch(r)}: ${cut(r.subject || r.template_key, 100)}`;
    }
    if (r.status === 'test' && r.automation_id !== 'inbox_ai_person') continue;
    items.push({ at, line: `${day(at)} · ${line}${STATUS(r.status)}` });
  }
  for (const f of feedback) {
    items.push({ at: f.created_at, line: `${day(f.created_at)} · Their feedback${f.rating ? ` ${f.rating}/5 stars` : ''}: “${cut(f.message, 160)}”` });
  }
  return items.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, max).map((x) => x.line);
}
