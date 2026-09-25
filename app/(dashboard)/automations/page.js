'use client';
// Automations — the built-in "first listing → free home display" flow for the active
// country, laid out as one horizontal row of steps: trigger → wait → gift email →
// ending-soon email. Each email step picks which template it sends. The buyer
// portal's hourly cron (/api/cron/automations) does the sending; this page only
// configures it.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, PageHeader, Banner, PendingMigration, fmtDate, btnPrimary } from '@/components/automations/ui';

// One step of the flow: a numbered card. Kind sets the label above the title.
function StepCard({ n, kind, title, children }) {
  return (
    <div className="relative flex-1 min-w-0 flex flex-col rounded-[14px] p-4" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="w-6 h-6 shrink-0 rounded-full bg-ink text-paper flex items-center justify-center text-[11px] font-bold">{n}</span>
        <span className="text-[10px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{kind}</span>
      </div>
      <div className="text-[14px] font-bold leading-snug" style={{ color: T.textPrimary }}>{title}</div>
      <div className="mt-3 flex-1 flex flex-col gap-3 text-[13px]" style={{ color: T.textBody }}>{children}</div>
    </div>
  );
}

// The arrow between steps: horizontal on wide screens, vertical when stacked.
function Connector() {
  return (
    <div className="flex items-center justify-center shrink-0 lg:w-6 h-6 lg:h-auto" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rotate-90 lg:rotate-0">
        <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
      </svg>
    </div>
  );
}

function DayField({ value, onChange, min, max, error, suffix }) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <input type="number" min={min} max={max} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          className="w-[70px] px-2.5 py-1.5 rounded-[10px] border text-[15px] font-bold text-center outline-none focus:border-ink/60 tabular-nums"
          style={{ borderColor: error ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
        <span className="text-[13px]" style={{ color: T.textSecondary }}>{suffix}</span>
      </div>
      {error ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{error}</p> : null}
    </div>
  );
}

// Pick the template an email step sends; shows its subject and an Edit link.
function TemplatePicker({ label, value, templates, onChange, error }) {
  const chosen = templates.find((t) => String(t.id) === String(value));
  return (
    <div className="rounded-[12px] p-3" style={{ background: T.bgSurface, border: `1px solid ${error ? T.danger : T.borderLight}` }}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <span className="text-[10px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{label}</span>
        {chosen && <Link href={`/email-templates/${chosen.id}`} className="text-[11px] underline underline-offset-2" style={{ color: T.textSecondary }}>Edit</Link>}
      </div>
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 rounded-[10px] border text-[13px] font-medium outline-none focus:border-ink/60"
        style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary, background: T.bgWhite }}>
        <option value="">Choose a template…</option>
        {templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active ? '' : ' (off)'}</option>)}
      </select>
      <p className="text-[11px] mt-1.5 leading-snug truncate" style={{ color: chosen ? T.textBody : T.textMuted }} title={chosen?.subject || ''}>
        {chosen ? <>Subject: {chosen.subject}</> : 'No email will be sent until you choose one.'}
      </p>
      {chosen && !chosen.is_active && <p className="text-[11px] mt-1" style={{ color: T.warning }}>This template is switched off, so this email is skipped.</p>}
      {error ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{error}</p> : null}
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

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/automations', { cache: 'no-store' });
        const j = await res.json();
        if (j.pending) { setPending(true); return; }
        if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`);
        apply(j);
      } catch (e) { setError(String(e.message || e)); }
    })();
  }, []);

  async function put(patch, okText) {
    setErrors({}); setNotice(''); setError('');
    const res = await fetch('/api/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await res.json();
    if (res.status === 400 && j.errors) { setErrors(j.errors); setError(j.errors.enabled || 'Fix the highlighted fields.'); return false; }
    if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return false; }
    apply(j);
    if (okText) setNotice(okText);
    return true;
  }

  async function toggle() {
    const turningOn = !data.automation.enabled;
    if (turningOn && !window.confirm('Switch the automation on?\n\nOnly sellers whose FIRST listing is published from now on get the free home display and the emails. Nobody who already published is affected.')) return;
    if (!turningOn && !window.confirm('Switch the automation off?\n\nNobody new gets the gift. Sellers already on free display keep it until it ends, but won’t get the reminder email.')) return;
    setBusy('toggle');
    await put({ enabled: turningOn }, turningOn ? 'The automation is on.' : 'The automation is off.');
    setBusy('');
  }

  async function save() {
    setBusy('save');
    await put(form, 'Changes saved.');
    setBusy('');
  }

  if (pending) return <div className="space-y-5"><PageHeader title="Automations" /><PendingMigration /></div>;
  if (!data || !form) return <div className="space-y-5"><PageHeader title="Automations" />{error ? <Banner>{error}</Banner> : <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>}</div>;

  const a = data.automation;
  const setF = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = ['wait_days', 'free_days', 'remind_days_before', 'gift_template_id', 'reminder_template_id']
    .some((k) => String(form[k] ?? '') !== String(a[k] ?? ''));

  return (
    <div className="space-y-5">
      <PageHeader title="Automations" sub="Emails and rewards that run on their own, checked every hour." />
      {error && <Banner>{error}</Banner>}
      {notice && <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.successSurface, color: T.success }}>{notice}</div>}

      <section className="rounded-[18px] overflow-hidden" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
        {/* Header: name, what it does, on/off */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 md:px-6 py-5 border-b" style={{ borderColor: T.borderLight }}>
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <h2 className="text-[18px] font-bold tracking-head" style={{ color: T.textPrimary }}>First listing → free home display</h2>
              <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={a.enabled ? { background: T.successSurface, color: T.success } : { background: T.bgSurface, color: T.textMuted }}>{a.enabled ? 'Live' : 'Off'}</span>
            </div>
            <p className="text-[13px] mt-1" style={{ color: T.textSecondary }}>
              A thank-you for a seller’s first listing: free days on the home page, then an offer to extend for US$20.
              {a.enabled && a.enabled_at ? ` On since ${fmtDate(a.enabled_at, true)}.` : ''}
            </p>
          </div>
          <button onClick={toggle} disabled={!!busy} role="switch" aria-checked={a.enabled} aria-label="Automation on or off"
            className="inline-flex items-center gap-3 pl-2 pr-4 py-1.5 rounded-full border text-[13px] font-semibold transition-colors disabled:opacity-50"
            style={a.enabled ? { background: T.successSurface, borderColor: T.success, color: T.success } : { background: T.bgWhite, borderColor: 'rgba(17,17,17,.2)', color: T.textBody }}>
            <span className="relative w-10 h-[22px] rounded-full transition-colors" style={{ background: a.enabled ? T.success : 'rgba(17,17,17,.2)' }}>
              <span className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: a.enabled ? 21 : 3 }} />
            </span>
            {busy === 'toggle' ? 'Saving…' : a.enabled ? 'On' : 'Off'}
          </button>
        </div>

        {/* The flow, left to right */}
        <div className="p-4 md:p-5" style={{ background: T.bgSurface }}>
          <div className="flex flex-col lg:flex-row lg:items-stretch gap-2 lg:gap-1">
            <StepCard n={1} kind="Trigger" title="A seller publishes their first listing">
              <p style={{ color: T.textSecondary }}>Only listings with a photo, published after the automation is switched on.</p>
            </StepCard>
            <Connector />
            <StepCard n={2} kind="Wait" title="Wait before the gift">
              <DayField value={form.wait_days} onChange={setF('wait_days')} min={0} max={60} error={errors.wait_days} suffix="days" />
            </StepCard>
            <Connector />
            <StepCard n={3} kind="Gift" title="Free home display + thank-you email">
              <DayField value={form.free_days} onChange={setF('free_days')} min={1} max={365} error={errors.free_days} suffix="days on the home page" />
              <TemplatePicker label="Email sent" value={form.gift_template_id} templates={data.templates} onChange={setF('gift_template_id')} />
            </StepCard>
            <Connector />
            <StepCard n={4} kind="Reminder" title="Ending-soon email with the pay button">
              <DayField value={form.remind_days_before} onChange={setF('remind_days_before')} min={1} max={60} error={errors.remind_days_before} suffix="days before the end" />
              <TemplatePicker label="Email sent" value={form.reminder_template_id} templates={data.templates} onChange={setF('reminder_template_id')} />
            </StepCard>
          </div>
        </div>

        {/* Footer: save */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 py-4 border-t" style={{ borderColor: T.borderLight }}>
          <p className="text-[12px]" style={{ color: T.textMuted }}>
            Paid home listings always come first; free ones only fill empty home slots. After the free days the listing stays live, just not on the home page.
          </p>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-[12px]" style={{ color: T.textMuted }}>Unsaved changes</span>}
            <button onClick={save} disabled={!dirty || !!busy} className={btnPrimary}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}
