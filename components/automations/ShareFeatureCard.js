'use client';
// "Share feature announcement" card on the Automations page (its own API:
// /api/automations/share-feature, lib/shareFeatureAdmin.js). The website's hourly cron sends the
// emails (lib/automations/shareFeature.js there): every N hours to verified members, up to N
// times (0 = no limit); test / team accounts never.
import { useEffect, useState } from 'react';
import { T, Banner } from '@/components/automations/ui';
import { StepCard, Connector, DayField, TemplatePicker, AutomationCard } from '@/components/automations/parts';
import { useDialog } from '@/components/Dialog';
import { SHARE_FEATURE_RANGES, shareFeatureScheduleText } from '@/lib/shareFeature';

const formOf = (s) => ({ firstAfterHours: s.firstAfterHours, everyHours: s.everyHours, maxSends: s.maxSends, perRun: s.perRun, templateId: s.templateId || '' });
const R = SHARE_FEATURE_RANGES;

export default function ShareFeatureCard() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const { dialog, confirm } = useDialog();

  const apply = (j) => { setData(j); setForm(formOf(j.settings)); };
  useEffect(() => {
    fetch('/api/automations/share-feature', { cache: 'no-store' }).then((r) => r.json())
      .then((j) => (j.error || j.pending ? setError(j.pending ? 'Automations are not set up for this country yet.' : j.error) : apply(j)))
      .catch((e) => setError(String(e.message || e)));
  }, []);

  async function save(patch, ok) {
    setErrors({}); setNotice('');
    const res = await fetch('/api/automations/share-feature', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await res.json().catch(() => ({}));
    if (res.status === 400 && j.errors) { setErrors(j.errors); setNotice(j.errors.enabled || 'Fix the highlighted fields.'); return false; }
    if (!res.ok) { setNotice(j.message || j.error || `HTTP ${res.status}`); return false; }
    apply(j);
    setNotice(ok);
    return true;
  }
  const run = async (kind, fn) => { setBusy(kind); try { await fn(); } finally { setBusy(''); } };

  if (error && !data) return <Banner>Share feature announcement: {error}</Banner>;
  if (!data || !form) return null;

  const s = data.settings;
  const c = data.counts;
  const dirty = JSON.stringify(form) !== JSON.stringify(formOf(s));
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const preview = shareFeatureScheduleText({ ...s, ...form, everyHours: Number(form.everyHours) || s.everyHours, maxSends: form.maxSends === '' ? s.maxSends : Number(form.maxSends) });

  const toggle = () => run('toggle', async () => {
    const on = !s.enabled;
    const go = await confirm({
      title: on ? 'Switch the share feature announcement on?' : 'Switch the share feature announcement off?',
      message: on
        ? `Every verified member (buyers and sellers, not test or team accounts) gets the email: ${preview}. At most ${form.perRun} emails per hourly run, daytime only.`
        : 'No more announcement emails go out until you switch it on again.',
      confirmLabel: on ? 'Switch on' : 'Switch off', tone: on ? undefined : 'danger',
    });
    if (!go) return;
    await save(dirty || !s.setUp ? { ...form, enabled: on } : { enabled: on }, on ? 'The announcement is on.' : 'The announcement is off.');
  });

  return (
    <div id="share-feature" className="scroll-mt-6">
      {dialog}
      <AutomationCard
        title="Share feature announcement"
        description='Tell members about sharing: WhatsApp, Instagram, Gmail, X or a copied link bring more visits; the 3 steps and a "Ver la demo" button (YouTube). Sent again every few hours, as many times as you choose.'
        enabled={s.enabled} enabledAt={s.enabledAt} busy={busy}
        onToggle={toggle} dirty={dirty || !s.setUp}
        onSave={() => run('save', () => save(form, s.setUp ? 'Changes saved.' : 'Saved (off) — the email was created (Templates).'))}
        footnote={`${notice ? `${notice} ` : ''}Test and team accounts, closed accounts, WhatsApp BAJA and bounced / spam addresses are skipped. Daytime only.${s.setUp ? ` ${c.sent} sent so far to ${c.people} ${c.people === 1 ? 'person' : 'people'} (${c.last7} in the last 7 days)${c.stopped ? `, ${c.stopped} stopped by a bounce or spam report` : ''}. Opens and clicks: Email campaigns.` : ' Not set up for this country yet: saving creates it, switched off.'}`}
      >
        <StepCard n={1} kind="Who" title="Verified members (buyers and sellers)">
          <p className="text-[12px] leading-snug" style={{ color: T.textBody }}>Accounts that existed when it was switched on: at the next daytime run. New accounts:</p>
          <DayField value={form.firstAfterHours} onChange={set('firstAfterHours')} min={R.firstAfterHours[0]} max={R.firstAfterHours[1]} error={errors.firstAfterHours} suffix="hours after sign-up" />
        </StepCard>
        <Connector />
        <StepCard n={2} kind="Repeat" title="Send it again">
          <DayField value={form.everyHours} onChange={set('everyHours')} min={R.everyHours[0]} max={R.everyHours[1]} error={errors.everyHours} suffix="hours between emails" />
          <DayField value={form.maxSends} onChange={set('maxSends')} min={R.maxSends[0]} max={R.maxSends[1]} error={errors.maxSends} suffix="times per person (0 = no limit)" />
          <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Now: {preview}.</p>
        </StepCard>
        <Connector />
        <StepCard n={3} kind="Email" title="The announcement">
          <TemplatePicker label="Email" value={form.templateId} templates={data.templates} onChange={set('templateId')} error={errors.templateId} />
          <DayField value={form.perRun} onChange={set('perRun')} min={R.perRun[0]} max={R.perRun[1]} error={errors.perRun} suffix="emails per hourly run, at most" />
        </StepCard>
      </AutomationCard>
    </div>
  );
}
