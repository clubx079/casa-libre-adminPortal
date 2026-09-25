'use client';
// Automations — the built-in "first listing → free home display" flow for the active
// country: on/off, the editable timeline (days + which template each email uses),
// results, and the latest people in the flow. The buyer portal's hourly cron
// (/api/cron/automations) does the work; this page only configures and reports.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, CARD, PageHeader, Pill, Banner, PendingMigration, fmtDate, btnPrimary } from '@/components/automations/ui';

const STATUS = {
  gifted: ['success', 'On free display'],
  reminded: ['info', 'Reminder sent'],
  converted: ['ink', 'Paid to extend'],
  done: ['neutral', 'Finished'],
  skipped: ['warning', 'Skipped'],
};
const SKIP = {
  not_first: 'had a listing before the automation was on',
  no_photo: 'first listing has no photo (can’t show on the home page)',
  inactive: 'first listing isn’t active',
  already_promoted: 'first listing was already paid for',
  grant_failed: 'couldn’t turn on the home display',
};

function DayInput({ value, onChange, min, max, error }) {
  return (
    <span className="inline-flex flex-col">
      <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
        className="w-16 px-2 py-1 rounded-[10px] border text-[14px] font-bold text-center outline-none focus:border-ink/60"
        style={{ borderColor: error ? T.danger : 'rgba(17,17,17,.2)' }} />
      {error ? <span className="text-[10px] mt-0.5" style={{ color: T.danger }}>{error}</span> : null}
    </span>
  );
}

function Step({ n, title, children, last }) {
  return (
    <div className="flex gap-3.5">
      <div className="flex flex-col items-center">
        <span className="w-7 h-7 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center text-[12px] font-bold">{n}</span>
        {!last && <span className="flex-1 w-px my-1" style={{ background: T.borderLight }} />}
      </div>
      <div className={`flex-1 min-w-0 ${last ? '' : 'pb-5'}`}>
        <div className="text-[13px] font-bold" style={{ color: T.textPrimary }}>{title}</div>
        <div className="text-[13px] mt-1 flex flex-wrap items-center gap-2" style={{ color: T.textBody }}>{children}</div>
      </div>
    </div>
  );
}

export default function AutomationsPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  function apply(j) {
    setData(j);
    const a = j.automation;
    setForm({ wait_days: a.wait_days, free_days: a.free_days, remind_days_before: a.remind_days_before, gift_template_id: a.gift_template_id || '', reminder_template_id: a.reminder_template_id || '' });
  }

  async function load() {
    try {
      const res = await fetch('/api/automations', { cache: 'no-store' });
      const j = await res.json();
      if (j.pending) { setPending(true); return; }
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
      apply(j);
    } catch (e) { setError(String(e.message || e)); }
  }
  useEffect(() => { load(); }, []);

  async function put(patch, okText) {
    setErrors({}); setNotice(''); setError('');
    const res = await fetch('/api/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await res.json();
    if (res.status === 400 && j.errors) { setErrors(j.errors); if (j.errors.enabled) setError(j.errors.enabled); return false; }
    if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return false; }
    apply(j);
    if (okText) setNotice(okText);
    return true;
  }

  async function toggle() {
    const turningOn = !data.automation.enabled;
    if (turningOn && !window.confirm('Switch the automation on?\n\nOnly people whose FIRST listing is published from now on will get the free home display and the emails. Nobody who already published is affected.')) return;
    if (!turningOn && !window.confirm('Switch the automation off?\n\nNobody new gets the gift. People already on free display keep it until it ends, but won’t get the reminder email.')) return;
    setBusy('toggle');
    await put({ enabled: turningOn }, turningOn ? 'Automation is on.' : 'Automation is off.');
    setBusy('');
  }

  async function saveSettings() {
    setBusy('save');
    await put(form, 'Changes saved.');
    setBusy('');
  }

  if (pending) return <div className="space-y-5"><PageHeader title="Automations" /><PendingMigration /></div>;
  if (!data || !form) return <div className="space-y-5"><PageHeader title="Automations" />{error ? <Banner>{error}</Banner> : <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>}</div>;

  const a = data.automation;
  const s = data.stats;
  const dirty = ['wait_days', 'free_days', 'remind_days_before', 'gift_template_id', 'reminder_template_id']
    .some((k) => String(form[k] ?? '') !== String(a[k] ?? ''));
  const setF = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const tplSelect = (k) => (
    <span className="inline-flex items-center gap-2">
      <select value={form[k] || ''} onChange={(e) => setF(k)(e.target.value)} className="px-3 py-1.5 rounded-full border text-[12px] outline-none" style={{ borderColor: T.borderLight, color: T.textBody, background: T.bgWhite }}>
        <option value="">Pick a template…</option>
        {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (off)'}</option>)}
      </select>
      {form[k] && <Link href={`/email-templates/${form[k]}`} className="text-[12px] underline underline-offset-2" style={{ color: T.textSecondary }}>Edit</Link>}
    </span>
  );

  return (
    <div className="space-y-5">
      <PageHeader title="Automations" sub="Emails and rewards that run on their own. Checked every hour." />
      {error && <Banner>{error}</Banner>}
      {notice && <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.successSurface, color: T.success }}>{notice}</div>}

      <div className="p-5" style={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
          <div>
            <h2 className="text-[16px] font-bold tracking-head" style={{ color: T.textPrimary }}>First listing → free home display</h2>
            <p className="text-[12px] mt-0.5" style={{ color: T.textSecondary }}>
              A thank-you for a seller’s first listing: free days on the home page, then an offer to extend for US$20.
              {a.enabled && a.enabled_at ? ` On since ${fmtDate(a.enabled_at, true)} — only first listings from then on count.` : ''}
            </p>
          </div>
          <button onClick={toggle} disabled={!!busy} role="switch" aria-checked={a.enabled}
            className="inline-flex items-center gap-2.5 px-3.5 py-1.5 rounded-full border text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={a.enabled ? { background: T.successSurface, borderColor: T.success, color: T.success } : { background: T.bgWhite, borderColor: T.borderLight, color: T.textBody }}>
            <span className="relative w-8 h-[18px] rounded-full transition-colors" style={{ background: a.enabled ? T.success : 'rgba(17,17,17,.2)' }}>
              <span className="absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white transition-all" style={{ left: a.enabled ? 16 : 2 }} />
            </span>
            {busy === 'toggle' ? 'Saving…' : a.enabled ? 'On' : 'Off'}
          </button>
        </div>

        <Step n={1} title="Trigger">A seller publishes their first listing (with a photo).</Step>
        <Step n={2} title="Wait">
          <DayInput value={form.wait_days} onChange={setF('wait_days')} min={0} max={60} error={errors.wait_days} /> days
        </Step>
        <Step n={3} title="Gift: free home display + email">
          Show the listing on the home page for <DayInput value={form.free_days} onChange={setF('free_days')} min={1} max={365} error={errors.free_days} /> days,
          and send {tplSelect('gift_template_id')}
        </Step>
        <Step n={4} title="Ending-soon email with the pay button" last>
          <DayInput value={form.remind_days_before} onChange={setF('remind_days_before')} min={1} max={60} error={errors.remind_days_before} /> days before it ends, send {tplSelect('reminder_template_id')}
        </Step>

        <div className="flex flex-wrap items-center gap-3 mt-5 pt-4 border-t" style={{ borderColor: T.borderLight }}>
          <button onClick={saveSettings} disabled={!dirty || !!busy} className={btnPrimary}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
          <span className="text-[11px]" style={{ color: T.textMuted }}>
            Paid home listings always come first; free ones only fill empty home slots. After the free days the listing stays live, just not on the home page.
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          ['On free display now', s.inFlow],
          ['Gifts given', s.gifted],
          ['Reminders sent', s.reminded],
          ['Paid to extend', s.converted, s.gifted ? `${Math.round((s.converted / s.gifted) * 1000) / 10}% of gifts` : null],
          ['Revenue', `US$${s.revenueUsd.toLocaleString('en-US')}`],
        ].map(([k, v, sub]) => (
          <div key={k} className="p-4" style={CARD}>
            <p className="text-xs font-medium" style={{ color: T.textSecondary }}>{k}</p>
            <p className="text-2xl font-bold tracking-head mt-2" style={{ color: T.textPrimary }}>{typeof v === 'number' ? v.toLocaleString('en-US') : v}</p>
            {sub ? <p className="text-[10px] mt-0.5" style={{ color: T.textMuted }}>{sub}</p> : null}
          </div>
        ))}
      </div>

      <div className="overflow-hidden" style={CARD}>
        <div className="px-5 py-3 border-b flex items-center justify-between" style={{ borderColor: T.borderLight }}>
          <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Recent activity</h2>
          <span className="text-[11px]" style={{ color: T.textMuted }}>latest 20 · skipped: {s.skipped}</span>
        </div>
        <div className="cl-scroll overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>
                {['Seller', 'Listing', 'Status', 'Gift sent', 'Free until', 'Note'].map((h) => (
                  <th key={h} className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-left" style={{ color: T.textMuted }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.recent.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: T.textMuted }}>
                  {a.enabled ? 'Nobody yet — the first sellers appear here once their first listing is a few days old.' : 'Switch the automation on to start.'}
                </td></tr>
              ) : data.recent.map((r) => {
                const [tone, label] = STATUS[r.status] || ['neutral', r.status];
                return (
                  <tr key={r.id} className="border-b" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3 text-xs max-w-[200px]">
                      <p className="text-[13px] font-medium truncate" style={{ color: T.textPrimary }}>{r.user}</p>
                      {r.email && <p className="text-[11px] font-mono truncate" style={{ color: T.textMuted }}>{r.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[200px] truncate" style={{ color: T.textBody }}>{r.property}</td>
                    <td className="px-4 py-3"><Pill tone={tone}>{label}</Pill></td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textBody }}>{fmtDate(r.gifted_at)}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textBody }}>{fmtDate(r.free_until)}</td>
                    <td className="px-4 py-3 text-xs max-w-[260px]" style={{ color: r.last_error ? T.danger : T.textMuted }}>
                      {r.last_error ? `Email failed: ${r.last_error}` : r.status === 'skipped' ? (SKIP[r.skip_reason] || r.skip_reason) : r.reminded_at ? `Reminder ${fmtDate(r.reminded_at)}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
