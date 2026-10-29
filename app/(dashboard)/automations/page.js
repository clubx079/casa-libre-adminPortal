'use client';
// Automations — the built-in flows for the active country, each laid out as one
// horizontal row of steps: "first listing → free home display" (trigger → wait → gift
// email → ending-soon email), "listing getting views" and "unfinished draft reminders"
// (trigger → reminder steps → email), and "signed up, no listing yet" (trigger → wait →
// welcome email → optional second email). Each email step picks which template it sends.
// The buyer portal's hourly cron (/api/cron/automations) does the sending; this page
// only configures it.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, PageHeader, Banner, PendingMigration, fmtDate, btnPrimary } from '@/components/automations/ui';
import { stepsFromHours, stepLabel, DRAFT_STEPS } from '@/lib/automationAdmin';
import { templateOptionLabel, fixedEnglish } from '@/lib/templateEnglish';
import { useEnglishNames } from '@/components/automations/useEnglishNames';
import { ChannelControl } from '@/components/automations/WhatsAppChannels';
import { useDialog } from '@/components/Dialog';

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

// "#1–30 → 30 days · next 20 → 20 days · … · after that → 7 days" — add / remove rows.
function TierList({ tiers, later, errors, onChange, onLater }) {
  const set = (i, k) => (v) => onChange(tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)));
  const add = () => onChange([...tiers, { sellers: 10, days: Math.max(1, Math.min(...tiers.map((t) => Number(t.days) || 1), Number(later) + 1 || 1)) }]);
  const remove = (i) => onChange(tiers.filter((_, j) => j !== i));
  let from = 1;
  const ranges = tiers.map((t) => { const n = Number(t.sellers) || 0, r = n ? `#${from}–${from + n - 1}` : '—'; from += n; return r; });
  return (
    <div className="space-y-2.5" data-testid="tier-list">
      {tiers.map((t, i) => (
        <div key={i} className="rounded-[12px] border px-3 py-2.5 space-y-2" style={{ borderColor: 'rgba(17,17,17,.12)', background: '#fff' }}>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>
              {i === 0 ? 'The first' : 'The next'} <span className="font-mono normal-case tracking-normal" style={{ color: T.textMuted }}>({ranges[i]})</span>
            </p>
            {tiers.length > 1 && (
              <button type="button" onClick={() => remove(i)} aria-label={`Remove tier ${i + 1}`} className="w-6 h-6 rounded-full text-[14px] leading-none hover:bg-black/5" style={{ color: T.textMuted }}>×</button>
            )}
          </div>
          <DayField value={t.sellers} onChange={set(i, 'sellers')} min={1} max={100000} error={errors[`tier_${i}_sellers`]} suffix="sellers get…" />
          <DayField value={t.days} onChange={set(i, 'days')} min={1} max={365} error={errors[`tier_${i}_days`]} suffix="days on the home page" />
        </div>
      ))}
      {errors.free_tiers ? <p className="text-[11px]" style={{ color: T.danger }}>{errors.free_tiers}</p> : null}
      {tiers.length < 10 && (
        <button type="button" onClick={add} className="w-full py-2 rounded-[10px] border border-dashed text-[13px] font-semibold hover:bg-black/[.03]" style={{ borderColor: 'rgba(17,17,17,.25)', color: T.textBody }}>+ Add tier</button>
      )}
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>After that, everyone gets <span className="font-mono normal-case tracking-normal" style={{ color: T.textMuted }}>(#{from}+)</span></p>
        <DayField value={later} onChange={onLater} min={1} max={365} error={errors.later_free_days} suffix="days on the home page" />
      </div>
      <p className="text-[11px]" style={{ color: T.textMuted }}>Place in line counts every seller who ever published, including the early ones.</p>
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

// The draft reminders: 1–5 rows of "Reminder n · after [N] [hours|days]" — add / remove.
function DraftSteps({ steps, errors, onChange, note }) {
  const set = (i, k) => (v) => onChange(steps.map((s, j) => (j === i ? { ...s, [k]: v } : s)));
  const add = () => {
    const last = steps[steps.length - 1];
    const lastH = last ? Number(last.value || 0) * (last.unit === 'days' ? 24 : 1) : 0;
    const days = Math.min(60, Math.max(1, Math.ceil(lastH / 24) * 2 || 1));
    onChange([...steps, { value: days, unit: 'days' }]);
  };
  const remove = (i) => onChange(steps.filter((_, j) => j !== i));
  return (
    <div className="space-y-2.5" data-testid="draft-steps">
      {steps.map((s, i) => (
        <div key={i} className="rounded-[12px] border px-3 py-2.5" style={{ borderColor: errors[`step_${i}`] ? T.danger : 'rgba(17,17,17,.12)', background: '#fff' }}>
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>Reminder {i + 1}</p>
            {steps.length > 1 && (
              <button type="button" onClick={() => remove(i)} aria-label={`Remove reminder ${i + 1}`} className="w-6 h-6 rounded-full text-[14px] leading-none hover:bg-black/5" style={{ color: T.textMuted }}>×</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px]" style={{ color: T.textSecondary }}>after</span>
            <input type="number" min={1} max={s.unit === 'days' ? 60 : 1440} value={s.value} aria-label={`Reminder ${i + 1}: wait`}
              onChange={(e) => set(i, 'value')(e.target.value === '' ? '' : Number(e.target.value))}
              className="w-[64px] px-2 py-1.5 rounded-[10px] border text-[15px] font-bold text-center outline-none focus:border-ink/60 tabular-nums"
              style={{ borderColor: errors[`step_${i}`] ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
            <select value={s.unit} onChange={(e) => set(i, 'unit')(e.target.value)} aria-label={`Reminder ${i + 1}: hours or days`}
              className="px-2 py-1.5 rounded-[10px] border text-[13px] font-medium outline-none focus:border-ink/60"
              style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary, background: T.bgWhite }}>
              <option value="hours">hours</option>
              <option value="days">days</option>
            </select>
          </div>
          {errors[`step_${i}`] ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{errors[`step_${i}`]}</p> : null}
        </div>
      ))}
      {errors.steps ? <p className="text-[11px]" style={{ color: T.danger }}>{errors.steps}</p> : null}
      {steps.length < DRAFT_STEPS.max && (
        <button type="button" onClick={add} className="w-full py-2 rounded-[10px] border border-dashed text-[13px] font-semibold hover:bg-black/[.03]" style={{ borderColor: 'rgba(17,17,17,.25)', color: T.textBody }}>+ Add reminder</button>
      )}
      <p className="text-[11px]" style={{ color: T.textMuted }}>{note || <>Counted from the last time the seller opened or changed the draft. Each reminder goes once per draft (up to {DRAFT_STEPS.max}); coming back to the draft pushes the next one back.</>}</p>
    </div>
  );
}

// Pick the template an email step sends; shows its subject and an Edit link.
// Options read "English (Spanish)" — the emails themselves go out in Spanish.
function TemplatePicker({ label, value, templates, onChange, error }) {
  const chosen = templates.find((t) => String(t.id) === String(value));
  const enNames = useEnglishNames(templates);
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
        {templates.map((t) => <option key={t.id} value={t.id}>{templateOptionLabel(t.name, enNames[t.id])}{t.is_active ? '' : ' (off)'}</option>)}
      </select>
      <p className="text-[11px] mt-1.5 leading-snug truncate" style={{ color: chosen ? T.textBody : T.textMuted }} title={chosen?.subject || ''}>
        {chosen ? <>Subject: {chosen.subject}</> : 'No email will be sent until you choose one.'}
      </p>
      {chosen && fixedEnglish(chosen).subject && fixedEnglish(chosen).subject !== chosen.subject && (
        <p className="text-[11px] leading-snug truncate" style={{ color: T.textMuted }} title={fixedEnglish(chosen).subject}>In English: {fixedEnglish(chosen).subject}</p>
      )}
      {chosen && !chosen.is_active && <p className="text-[11px] mt-1" style={{ color: T.warning }}>This template is switched off, so this email is skipped.</p>}
      {error ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{error}</p> : null}
    </div>
  );
}

// One automation: name + status + on/off switch, the steps in a row, a save bar.
function AutomationCard({ title, description, enabled, enabledAt, busy, onToggle, dirty, onSave, footnote, channelId, children }) {
  return (
    <section className="rounded-[18px] overflow-hidden" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 md:px-6 py-5 border-b" style={{ borderColor: T.borderLight }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[18px] font-bold tracking-head" style={{ color: T.textPrimary }}>{title}</h2>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={enabled ? { background: T.successSurface, color: T.success } : { background: T.bgSurface, color: T.textMuted }}>{enabled ? 'Live' : 'Off'}</span>
          </div>
          <p className="text-[13px] mt-1" style={{ color: T.textSecondary }}>
            {description}{enabled && enabledAt ? ` On since ${fmtDate(enabledAt, true)}.` : ''}
          </p>
        </div>
        <button onClick={onToggle} disabled={!!busy} role="switch" aria-checked={enabled} aria-label={`${title}: on or off`}
          className="inline-flex items-center gap-3 pl-2 pr-4 py-1.5 rounded-full border text-[13px] font-semibold transition-colors disabled:opacity-50"
          style={enabled ? { background: T.successSurface, borderColor: T.success, color: T.success } : { background: T.bgWhite, borderColor: 'rgba(17,17,17,.2)', color: T.textBody }}>
          <span className="relative w-10 h-[22px] rounded-full transition-colors" style={{ background: enabled ? T.success : 'rgba(17,17,17,.2)' }}>
            <span className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow transition-all" style={{ left: enabled ? 21 : 3 }} />
          </span>
          {busy === 'toggle' ? 'Saving…' : enabled ? 'On' : 'Off'}
        </button>
      </div>
      {/* Send by Email | WhatsApp | Both (migration 017, components/automations/WhatsAppChannels.js) */}
      {channelId && <ChannelControl id={channelId} />}
      <div className="p-4 md:p-5" style={{ background: T.bgSurface }}>
        <div className="flex flex-col lg:flex-row lg:items-stretch gap-2 lg:gap-1">{children}</div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 py-4 border-t" style={{ borderColor: T.borderLight }}>
        <p className="text-[12px]" style={{ color: T.textMuted }}>{footnote}</p>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-[12px]" style={{ color: T.textMuted }}>Unsaved changes</span>}
          <button onClick={onSave} disabled={!dirty || !!busy} className={btnPrimary}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </section>
  );
}

export default function AutomationsPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [vform, setVform] = useState(null);
  const [dform, setDform] = useState(null);
  const [xform, setXform] = useState(null);
  const [nform, setNform] = useState(null);
  const [hform, setHform] = useState(null);
  const [sform, setSform] = useState(null);
  const [pform, setPform] = useState(null);
  const { dialog, confirm } = useDialog();
  // "Switch … on?\n\nwhat happens" → the admin dialog (title + text), Switch on / Switch off.
  const ask = (text) => {
    const [title, ...rest] = String(text).split('\n\n');
    const off = /\boff\?$/.test(title);
    return confirm({ title, message: rest.join('\n\n'), confirmLabel: off ? 'Switch off' : /\bon\?$/.test(title) ? 'Switch on' : 'OK', tone: off ? 'danger' : undefined });
  };
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});   // { first: {...}, views: {...} }
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState({});       // { first: 'toggle'|'save', views: … }

  function apply(j) {
    setData(j);
    const a = j.automation;
    setForm({ wait_days: a.wait_days, free_days: a.free_days, remind_days_before: a.remind_days_before, first_tier_count: a.first_tier_count, later_free_days: a.later_free_days, free_tiers: Array.isArray(a.free_tiers) ? a.free_tiers.map((t) => ({ sellers: t.sellers, days: t.days })) : undefined, gift_template_id: a.gift_template_id || '', reminder_template_id: a.reminder_template_id || '' });
    const v = j.views?.automation;
    setVform(v ? { milestones: (v.milestones || []).join(', '), template_id: v.template_id || '' } : null);
    const d = j.drafts?.automation;
    setDform(d ? { steps: stepsFromHours(d.milestones), template_id: d.template_id || '' } : null);
    const x = j.duplicates?.automation;
    setXform(x ? { template_id: x.template_id || '' } : null);
    const n = j.noListing?.settings;
    setNform(n ? { days: n.days, secondAfter: n.secondAfter, templateId: n.templateId, reminderTemplateId: n.reminderTemplateId } : null);
    const hs = j.listingHeld?.settings;
    setHform(hs ? { hours: hs.hours, reminderAfter: hs.reminderAfter } : null);
    const ps = j.paymentFollowup?.settings;
    setPform(ps ? { steps: stepsFromHours(ps.steps), reminderTemplateId: ps.reminderTemplateId || '', giftAfterDays: ps.giftAfterDays, giftTemplateId: ps.giftTemplateId || '', giftsPerPerson: ps.giftsPerPerson, giftWindowDays: ps.giftWindowDays, giftDays: ps.giftDays } : null);
    const ss = j.saves?.settings;
    setSform(ss ? { milestones: (ss.milestones || []).join(', '), template_id: ss.templateId || '' } : null);
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

  async function put(which, patch, okText) {
    setErrors({}); setNotice(''); setError('');
    const body = which === 'views' ? { id: 'listing_views_milestone', ...patch } : which === 'drafts' ? { id: 'draft_reminders', ...patch } : which === 'dups' ? { id: 'duplicate_listings', ...patch } : which === 'nolist' ? { id: 'no_listing_nudge', ...patch } : which === 'held' ? { id: 'listing_held', ...patch } : which === 'saves' ? { id: 'listing_saves_milestone', ...patch } : which === 'pay' ? { id: 'payment_followup', ...patch } : patch;
    const res = await fetch('/api/automations', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = await res.json();
    if (res.status === 400 && j.errors) { setErrors({ [which]: j.errors }); setError(j.errors.enabled || 'Fix the highlighted fields.'); return false; }
    if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return false; }
    apply(j);
    if (okText) setNotice(okText);
    return true;
  }
  const run = async (which, kind, fn) => { setBusy((b) => ({ ...b, [which]: kind })); await fn(); setBusy((b) => ({ ...b, [which]: '' })); };

  if (pending) return <div className="space-y-5"><PageHeader title="Automations" /><PendingMigration /></div>;
  if (!data || !form) return <div className="space-y-5"><PageHeader title="Automations" />{error ? <Banner>{error}</Banner> : <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>}</div>;

  const a = data.automation;
  const e1 = errors.first || {};
  const setF = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const hasTiers = a.first_tier_count !== undefined && a.later_free_days !== undefined;   // migration 009
  const hasTierList = Array.isArray(a.free_tiers);   // migration 010
  const dirty = ['wait_days', 'free_days', 'remind_days_before', 'first_tier_count', 'later_free_days', 'gift_template_id', 'reminder_template_id']
    .some((k) => String(form[k] ?? '') !== String(a[k] ?? ''))
    || (hasTierList && JSON.stringify(form.free_tiers || []) !== JSON.stringify((a.free_tiers || []).map((t) => ({ sellers: t.sellers, days: t.days }))));
  // Only send the tier list once the column exists; before that the single-tier fields apply.
  const firstPatch = () => { const { free_tiers, ...rest } = form; return hasTierList ? { ...rest, free_tiers } : rest; };

  const toggleFirst = async () => {
    const on = !a.enabled;
    if (on && !(await ask('Switch the automation on?\n\nOnly sellers whose FIRST listing is published from now on get the free home display and the emails. Nobody who already published is affected.'))) return;
    if (!on && !(await ask('Switch the automation off?\n\nNobody new gets the gift. Sellers already on free display keep it until it ends, but won’t get the reminder email.'))) return;
    run('first', 'toggle', () => put('first', { enabled: on }, on ? 'First listing automation is on.' : 'First listing automation is off.'));
  };

  const va = data.views?.automation;
  const e2 = errors.views || {};
  const vDirty = !!(va && vform && (vform.milestones.replace(/\s/g, '') !== (va.milestones || []).join(',') || String(vform.template_id || '') !== String(va.template_id || '')));
  const toggleViews = async () => {
    const on = !va.enabled;
    if (on && !(await ask('Switch "Listing getting views" on?\n\nSellers get an email when their listing reaches your view numbers. Listings that already passed a number before now won’t be emailed for it.'))) return;
    run('views', 'toggle', () => put('views', { enabled: on }, on ? '“Listing getting views” is on.' : '“Listing getting views” is off.'));
  };

  const da = data.drafts?.automation;
  const e3 = errors.drafts || {};
  const savedSteps = da ? stepsFromHours(da.milestones) : [];
  const dDirty = !!(da && dform && (JSON.stringify(dform.steps.map((s) => ({ value: Number(s.value), unit: s.unit }))) !== JSON.stringify(savedSteps) || String(dform.template_id || '') !== String(da.template_id || '')));
  const toggleDrafts = async () => {
    const on = !da.enabled;
    const when = (da.milestones || []).map(stepLabel).join(', ');
    if (on && !(await ask(`Switch "Unfinished draft reminders" on?\n\nSellers with an unfinished draft get an email after ${when || 'your waits'} without changes, with a button that opens the draft. Drafts already waiting get ONE email for the latest reminder they reached (if it came due in the last 7 days).`))) return;
    run('drafts', 'toggle', () => put('drafts', { enabled: on }, on ? '“Unfinished draft reminders” is on.' : '“Unfinished draft reminders” is off.'));
  };
  const perStep = data.drafts?.perStep || {};
  const draftStats = [
    data.drafts?.sent ? `${data.drafts.sent.toLocaleString('en-US')} sent so far${Object.keys(perStep).length > 1 ? ` (${Object.keys(perStep).sort((x, y) => x - y).map((k) => `#${k}: ${perStep[k]}`).join(' · ')})` : ''}.` : '',
    data.drafts?.waiting != null ? `${data.drafts.waiting.toLocaleString('en-US')} unfinished ${data.drafts.waiting === 1 ? 'draft' : 'drafts'} right now.` : '',
  ].filter(Boolean).join(' ');

  const xa = data.duplicates?.automation;
  const xDirty = !!(xa && xform && String(xform.template_id || '') !== String(xa.template_id || ''));
  const toggleDups = async () => {
    const on = !xa.enabled;
    if (on && !(await ask('Switch "Same property listed twice" on?\n\nA listing that repeats one of the user\'s own (same details + half or more of the same photos) is held as "Under review — possible duplicate" instead of published, and the user is emailed right away.'))) return;
    run('dups', 'toggle', () => put('dups', { enabled: on }, on ? '“Same property listed twice” is on.' : '“Same property listed twice” is off.'));
  };

  const nl = data.noListing;
  const ns = nl?.settings;
  const e5 = errors.nolist || {};
  const nDirty = !!(ns && nform && (['days', 'secondAfter', 'templateId', 'reminderTemplateId'].some((k) => String(nform[k] ?? '') !== String(ns[k] ?? ''))));
  const nHasSecond = !!(nform && nform.secondAfter !== '' && Number(nform.secondAfter) > 0);
  const toggleNoListing = async () => {
    const on = !ns.enabled;
    if (on && !(await ask(`Switch "Signed up, no listing yet" on?\n\nVerified users who signed up ${ns.days} ${ns.days === 1 ? 'day' : 'days'} ago or more and have no listing and no draft get the welcome email, once. People who signed up before now only get it if it came due in the last 7 days.${nl.setUp ? '' : '\n\nThis also creates the two default emails (Spanish) — edit them in Email templates.'}`))) return;
    run('nolist', 'toggle', () => put('nolist', { enabled: on }, on ? '“Signed up, no listing yet” is on.' : '“Signed up, no listing yet” is off.'));
  };
  const hl = data.listingHeld;
  const hs = hl?.settings;
  const e6 = errors.held || {};
  const hDirty = !!(hs && hform && ['hours', 'reminderAfter'].some((k) => String(hform[k] ?? '') !== String(hs[k] ?? '')));
  const hHasReminder = !!(hform && hform.reminderAfter !== '' && Number(hform.reminderAfter) > 0);
  const toggleHeld = async () => {
    const on = !hs.enabled;
    if (on && !(await ask(`Switch "Listing not published" on?\n\nOwners of user listings held off the site (waiting for payment, photos rejected, paused, missing details) get a message ${hs.hours} ${hs.hours === 1 ? 'hour' : 'hours'} later telling them why, with a button to My listings. Only listings created from now on.${hl.setUp ? '' : '\n\nThis also creates the four default emails (Spanish) — edit them in Templates.'}`))) return;
    run('held', 'toggle', () => put('held', { enabled: on }, on ? '“Listing not published” is on.' : '“Listing not published” is off.'));
  };
  const sv = data.saves;
  const ssv = sv?.settings;
  const e7 = errors.saves || {};
  const sDirty = !!(ssv && sform && (sform.milestones.replace(/s/g, '') !== (ssv.milestones || []).join(',') || String(sform.template_id || '') !== String(ssv.templateId || '')));
  const toggleSaves = async () => {
    const on = !ssv.enabled;
    if (on && !(await ask('Switch "Listing getting saved" on?\n\nSellers get a message when their listing reaches your numbers of saves (people with an account + visitors). Numbers a listing already passed before now are not sent.'))) return;
    run('saves', 'toggle', () => put('saves', { enabled: on, ...(sv.setUp ? {} : { milestones: sform.milestones }) }, on ? '“Listing getting saved” is on.' : '“Listing getting saved” is off.'));
  };
  // "Waiting for payment → free listing"
  const pf = data.paymentFollowup;
  const pfs = pf?.settings;
  const e8 = errors.pay || {};
  const toHours = (steps) => steps.map((s) => Number(s.value) * (s.unit === 'days' ? 24 : 1));
  const pPatch = () => pform && ({ steps: toHours(pform.steps), reminderTemplateId: pform.reminderTemplateId, giftAfterDays: pform.giftAfterDays === '' ? 0 : Number(pform.giftAfterDays), giftTemplateId: pform.giftTemplateId, giftsPerPerson: Number(pform.giftsPerPerson), giftWindowDays: Number(pform.giftWindowDays), giftDays: Number(pform.giftDays) });
  const pDirty = !!(pfs && pform && (JSON.stringify(toHours(pform.steps)) !== JSON.stringify(pfs.steps)
    || ['reminderTemplateId', 'giftAfterDays', 'giftTemplateId', 'giftsPerPerson', 'giftWindowDays', 'giftDays'].some((k) => String(pform[k] ?? '') !== String(pfs[k] ?? ''))));
  const pGift = !!(pform && Number(pform.giftAfterDays) > 0);
  const togglePay = async () => {
    const on = !pfs.enabled;
    if (on && !(await ask(`Switch "Waiting for payment → free listing" on?\n\nSellers whose listing is saved over the free listings of the month and not paid get payment reminders${pGift ? `, and after ${pform.giftAfterDays} days one email offering THAT listing for free (up to ${pform.giftsPerPerson} per person)` : ''}. Only listings saved from now on. While it is on, "Listing not published" stops sending its own payment message.${pf.setUp ? '' : '\n\nThis also creates the gift email (Spanish) — edit it in Templates.'}`))) return;
    run('pay', 'toggle', () => put('pay', { enabled: on, ...(pf.setUp ? {} : pPatch()) }, on ? '“Waiting for payment → free listing” is on.' : '“Waiting for payment → free listing” is off.'));
  };
  const pStats = pf ? [
    pf.reminders ? `${pf.reminders.toLocaleString('en-US')} reminders sent` : '',
    pf.offered ? `${pf.offered} ${pf.offered === 1 ? 'gift' : 'gifts'} offered · ${pf.claimed} taken` : '',
    pf.waiting != null ? `${pf.waiting} ${pf.waiting === 1 ? 'listing' : 'listings'} waiting for payment right now` : '',
  ].filter(Boolean).join(' · ') : '';
  const nPerStep = nl?.perStep || {};
  const nStats = nl?.sent ? ` ${nl.sent.toLocaleString('en-US')} sent so far${nPerStep['2'] ? ` (welcome: ${nPerStep['1'] || 0} · second: ${nPerStep['2']})` : ''}.` : '';

  return (
    <div className="space-y-5">
      {dialog}
      <PageHeader title="Automations" sub="Emails and rewards that run on their own, checked every hour." />
      {error && <Banner>{error}</Banner>}
      {notice && <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.successSurface, color: T.success }}>{notice}</div>}

      <AutomationCard
        title="First listing → free home display"
          channelId="first_listing_free_home"
        description="A thank-you for a seller’s first listing: free days on the home page, then an offer to extend for US$20."
        enabled={a.enabled} enabledAt={a.enabled_at} busy={busy.first}
        onToggle={toggleFirst} dirty={dirty} onSave={() => run('first', 'save', () => put('first', firstPatch(), 'Changes saved.'))}
        footnote="Paid home listings always come first; free ones only fill empty home slots. After the free days the listing stays live, just not on the home page."
      >
        <StepCard n={1} kind="Trigger" title="A seller publishes their first listing" />
        <Connector />
        <StepCard n={2} kind="Wait" title="Wait before the gift">
          <DayField value={form.wait_days} onChange={setF('wait_days')} min={0} max={60} error={e1.wait_days} suffix="days" />
        </StepCard>
        <Connector />
        <StepCard n={3} kind="Gift" title="Free home display + thank-you email">
          {hasTierList ? (
            <TierList tiers={form.free_tiers || []} later={form.later_free_days} errors={e1}
              onChange={(list) => setForm((f) => ({ ...f, free_tiers: list }))} onLater={setF('later_free_days')} />
          ) : hasTiers ? (
            <div className="space-y-2.5" data-testid="tiers">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>The first</p>
                <DayField value={form.first_tier_count} onChange={setF('first_tier_count')} min={0} max={100000} error={e1.first_tier_count} suffix="sellers to ever list get…" />
              </div>
              <DayField value={form.free_days} onChange={setF('free_days')} min={1} max={365} error={e1.free_days} suffix="days on the home page" />
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider mb-1" style={{ color: T.textSecondary }}>After that, everyone gets</p>
                <DayField value={form.later_free_days} onChange={setF('later_free_days')} min={1} max={365} error={e1.later_free_days} suffix="days on the home page" />
              </div>
              <p className="text-[11px]" style={{ color: T.textMuted }}>Place in line counts every seller who ever published, including the early ones.</p>
            </div>
          ) : (
            <>
              <DayField value={form.free_days} onChange={setF('free_days')} min={1} max={365} error={e1.free_days} suffix="days on the home page" />
              <p className="text-[11px]" style={{ color: T.textMuted }}>Apply <span className="font-mono">migrations/009_first_listing_tiers.sql</span> (buyer portal repo) to set “first 25 get 30 days, then 7 days”.</p>
            </>
          )}
          <TemplatePicker label="Email sent" value={form.gift_template_id} templates={data.templates} onChange={setF('gift_template_id')} />
        </StepCard>
        <Connector />
        <StepCard n={4} kind="Reminder" title="Ending-soon email with the pay button">
          <DayField value={form.remind_days_before} onChange={setF('remind_days_before')} min={1} max={60} error={e1.remind_days_before} suffix="days before the end" />
          {Number(form.remind_days_before) === 1 && <p className="text-[11px]" style={{ color: T.textMuted }}>Sent on the last day — e.g. day 6 of a 7-day gift.</p>}
          <TemplatePicker label="Email sent" value={form.reminder_template_id} templates={data.templates} onChange={setF('reminder_template_id')} />
        </StepCard>
      </AutomationCard>

      {va && vform ? (
        <AutomationCard
          title="Listing getting views"
          channelId="listing_views_milestone"
          description="Tells a seller their listing is getting attention, with the view count, and invites them to list another property."
          enabled={va.enabled} enabledAt={va.enabled_at} busy={busy.views}
          onToggle={toggleViews} dirty={vDirty} onSave={() => run('views', 'save', () => put('views', vform, 'Changes saved.'))}
          footnote={`Views are the same count as Analytics → Property analytics. Only listings sellers published themselves.${data.views.sent ? ` ${data.views.sent.toLocaleString('en-US')} sent so far.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller’s listing reaches a number of views" />
          <Connector />
          <StepCard n={2} kind="Views" title="Email at these view counts">
            <div>
              <input value={vform.milestones} onChange={(e) => setVform((f) => ({ ...f, milestones: e.target.value }))} placeholder="50" aria-label="View numbers"
                className="w-full px-3 py-2 rounded-[10px] border text-[15px] font-bold outline-none focus:border-ink/60 tabular-nums"
                style={{ borderColor: e2.milestones ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
              {e2.milestones
                ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{e2.milestones}</p>
                : <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>One number, or several separated by commas (e.g. 25, 50, 100). Each is emailed once per listing.</p>}
            </div>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Email to the seller">
            <TemplatePicker label="Email sent" value={vform.template_id} templates={data.templates} onChange={(v) => setVform((f) => ({ ...f, template_id: v }))} />
          </StepCard>
        </AutomationCard>
      ) : (
        <Banner tone="warning">
          <b>“Listing getting views” isn’t set up for this country yet.</b> Apply <span className="font-mono">migrations/006_views_automation.sql</span> (buyer portal repo) in the AiroBase SQL editor, then reload.
        </Banner>
      )}

      {ssv && sform ? (
        <AutomationCard
          title="Listing getting saved"
          channelId="listing_saves_milestone"
          description="Tells a seller that people are saving their listing — “10 personas guardaron tu propiedad” — with a button to it. Counts people with an account and visitors without one."
          enabled={ssv.enabled} enabledAt={ssv.enabledAt} busy={busy.saves}
          onToggle={toggleSaves} dirty={sDirty || !sv.setUp}
          onSave={() => run('saves', 'save', () => put('saves', { milestones: sform.milestones, ...(sv.setUp ? { template_id: sform.template_id } : {}) }, sv.setUp ? 'Changes saved.' : 'Saved — the default email was created (Templates).'))}
          footnote={`Only listings sellers published themselves. Each number is sent once per listing; a number already passed before it was switched on is skipped.${sv.setUp ? '' : ' Not set up for this country yet: saving creates it with a default email.'}${sv.sent ? ` ${sv.sent.toLocaleString('en-US')} sent so far.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="People save a seller’s listing (♥)" />
          <Connector />
          <StepCard n={2} kind="Saves" title="Message at these numbers of saves">
            <div>
              <input value={sform.milestones} onChange={(e) => setSform((f) => ({ ...f, milestones: e.target.value }))} placeholder="5, 10, 25" aria-label="Save numbers" data-testid="saves-milestones"
                className="w-full px-3 py-2 rounded-[10px] border text-[15px] font-bold outline-none focus:border-ink/60 tabular-nums"
                style={{ borderColor: e7.milestones ? T.danger : 'rgba(17,17,17,.2)', color: T.textPrimary }} />
              {e7.milestones
                ? <p className="text-[11px] mt-1" style={{ color: T.danger }}>{e7.milestones}</p>
                : <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>One number, or several separated by commas (e.g. 5, 10, 25). Each is sent once per listing.</p>}
            </div>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Message" title="Message to the seller">
            {sv.setUp
              ? <TemplatePicker label="Email sent" value={sform.template_id} templates={data.templates} onChange={(v) => setSform((f) => ({ ...f, template_id: v }))} />
              : <p className="text-[12px]" style={{ color: T.textMuted }}>A default email (Spanish) is created on save — edit it in Templates.</p>}
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Use <span className="font-mono">{'{{saves}}'}</span> for the number of saves and <span className="font-mono">{'{{property_url}}'}</span> for the listing link. Email / WhatsApp / Both: the channel picker above.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {da && dform ? (
        <AutomationCard
          title="Unfinished draft reminders"
          channelId="draft_reminders"
          description="Emails sellers who started a listing and left it as a draft, with a button that opens that draft so they can finish it."
          enabled={da.enabled} enabledAt={da.enabled_at} busy={busy.drafts}
          onToggle={toggleDrafts} dirty={dDirty}
          onSave={() => run('drafts', 'save', () => put('drafts', { steps: dform.steps, template_id: dform.template_id }, 'Changes saved.'))}
          footnote={`Signed-in sellers and guests who typed their email in the wizard. Stops as soon as the draft is published or deleted; at most one email per person per hour; a reminder more than 7 days late is skipped.${draftStats ? ` ${draftStats}` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller leaves a listing unfinished (saved as a draft)" />
          <Connector />
          <StepCard n={2} kind="Reminders" title="Email after this long without changes">
            <DraftSteps steps={dform.steps} errors={e3} onChange={(steps) => setDform((f) => ({ ...f, steps }))} />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Email with a button that opens the draft">
            <TemplatePicker label="Email sent at every reminder" value={dform.template_id} templates={data.templates} onChange={(v) => setDform((f) => ({ ...f, template_id: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              The button link is <span className="font-mono">{'{{draft_url}}'}</span> — My listings → Drafts, opening that draft in the wizard (after signing in, if needed).
            </p>
          </StepCard>
        </AutomationCard>
      ) : (
        <Banner tone="warning">
          <b>“Unfinished draft reminders” isn’t set up for this country yet.</b> Apply <span className="font-mono">migrations/013_draft_reminders.sql</span> (buyer portal repo) in the AiroBase SQL editor, then reload.
        </Banner>
      )}

      {xa && xform ? (
        <AutomationCard
          title="Same property listed twice"
          channelId="duplicate_listings"
          description="When a user publishes a listing that repeats one of their own, it is NOT published: it shows in My listings as “Under review — possible duplicate”, waits in Quarantine (Approve anyway publishes it) and the user gets this email right away."
          enabled={xa.enabled} enabledAt={xa.enabled_at} busy={busy.dups}
          onToggle={toggleDups} dirty={xDirty}
          onSave={() => run('dups', 'save', () => put('dups', { template_id: xform.template_id }, 'Changes saved.'))}
          footnote={`Repeat = every detail the same (type, rent/sale, price, currency, neighbourhood, city, areas, rooms, phone — the description may differ) AND half or more of the photos the same. Checked instantly when the listing is published. Off = repeats are published like any listing.${data.duplicates?.sent ? ` ${data.duplicates.sent.toLocaleString('en-US')} sent so far.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A user publishes a listing that repeats one of their own — it is held, not published" />
          <Connector />
          <StepCard n={2} kind="Email" title="Email with each copy's link and a My listings button">
            <TemplatePicker label="Email sent" value={xform.template_id} templates={data.templates} onChange={(v) => setXform((f) => ({ ...f, template_id: v }))} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Use <span className="font-mono">{'{{listing_links}}'}</span> for the links to each copy and <span className="font-mono">{'{{my_listings_url}}'}</span> for the button.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {ns && nform ? (
        <AutomationCard
          title="Signed up, no listing yet"
          channelId="no_listing_nudge"
          description="Welcomes verified users who created an account but never posted a listing — “Welcome to Casa Libre — post your first listing for free now” — with a button to the sell wizard."
          enabled={ns.enabled} enabledAt={ns.enabledAt} busy={busy.nolist}
          onToggle={toggleNoListing} dirty={nDirty || !nl.setUp}
          onSave={() => run('nolist', 'save', () => put('nolist', nform, nl.setUp ? 'Changes saved.' : 'Saved — the two default emails were created (Email templates).'))}
          footnote={`Skips anyone with a listing (any status) or an unfinished draft — drafts get the draft reminders instead. Each email goes once per person, in the daytime (9:00–21:00 local); one more than 7 days late is skipped.${nl.setUp ? '' : ' Not set up for this country yet: saving creates it with two default emails.'}${nStats}`}
        >
          <StepCard n={1} kind="Trigger" title="A verified user signs up and hasn’t posted a listing" />
          <Connector />
          <StepCard n={2} kind="Wait" title="Send the email this many days after sign-up">
            <DayField value={nform.days} onChange={(v) => setNform((f) => ({ ...f, days: v }))} min={1} max={60} error={e5.days} suffix="days after sign-up" />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Email" title="Welcome email with a button to publish for free">
            <TemplatePicker label="Email sent" value={nform.templateId} templates={data.templates} onChange={(v) => setNform((f) => ({ ...f, templateId: v }))} error={e5.templateId} />
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              The button link is <span className="font-mono">{'{{publish_url}}'}</span> — the sell wizard, tagged utm_campaign=no_listing_nudge.
            </p>
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Optional" title="Second email if they still haven’t listed">
            <DayField value={nform.secondAfter} onChange={(v) => setNform((f) => ({ ...f, secondAfter: v }))} min={0} max={59} error={e5.secondAfter} suffix="more days later" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>{nHasSecond ? `Sent ${Number(nform.days) + Number(nform.secondAfter)} days after sign-up.` : 'Leave empty (or 0) for no second email.'}</p>
            {nHasSecond && <TemplatePicker label="Email sent" value={nform.reminderTemplateId} templates={data.templates} onChange={(v) => setNform((f) => ({ ...f, reminderTemplateId: v }))} error={e5.reminderTemplateId} />}
          </StepCard>
        </AutomationCard>
      ) : null}

      {hs && hform ? (
        <AutomationCard
          title="Listing not published"
          channelId="listing_held"
          description="When a seller's listing is held off the site — waiting for payment, photos rejected, paused, or missing details — they get a message telling them why, with a button to My listings to fix it or pay."
          enabled={hs.enabled} enabledAt={hs.enabledAt} busy={busy.held}
          onToggle={toggleHeld} dirty={hDirty || !hl.setUp}
          onSave={() => run('held', 'save', () => put('held', hform, hl.setUp ? 'Changes saved.' : 'Saved — the four default emails were created (Templates).'))}
          footnote={`Only listings created after it is switched on. Stops as soon as the listing goes live. Duplicates and ended paid listings have their own emails. Daytime only (9:00–21:00 local).${hl.setUp ? '' : ' Not set up for this country yet: saving creates it with four default emails.'}${hl.sent ? ` ${hl.sent.toLocaleString('en-US')} sent so far (${hl.reasons.filter((r) => hl.perReason[r.reason]).map((r) => `${r.label.toLowerCase()}: ${hl.perReason[r.reason]}`).join(' · ')}).` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A seller's listing is held — not on the site" />
          <Connector />
          <StepCard n={2} kind="Wait" title="Send the message this many hours later">
            <DayField value={hform.hours} onChange={(v) => setHform((f) => ({ ...f, hours: v }))} min={1} max={720} error={e6.hours} suffix="hours after it was held" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>Gives them time to pay or fix it on the spot first.</p>
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Message" title="One message per reason, with a My listings button">
            <div className="space-y-1.5">
              {hl.reasons.map((r) => (
                <div key={r.reason} className="flex items-center justify-between gap-2 text-[12px] px-2.5 py-1.5 rounded-[8px]" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
                  <span style={{ color: T.textBody }}>{r.label}</span>
                  {r.template
                    ? <Link href={`/email-templates/${r.template.id}`} className="underline underline-offset-2 truncate max-w-[55%]" style={{ color: r.template.is_active === false ? T.textMuted : T.textSecondary }}>{r.template.is_active === false ? 'Off' : 'Edit email'}</Link>
                    : <span style={{ color: T.textMuted }}>{hl.setUp ? 'missing' : 'created on save'}</span>}
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Switch a reason off by switching its email off in Templates.</p>
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Optional" title="Reminder if it's still not published">
            <DayField value={hform.reminderAfter} onChange={(v) => setHform((f) => ({ ...f, reminderAfter: v }))} min={0} max={719} error={e6.reminderAfter} suffix="more hours later" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>{hHasReminder ? `Sent ${Number(hform.hours) + Number(hform.reminderAfter)} hours after it was held (same message).` : 'Leave empty (or 0) for no reminder.'}</p>
          </StepCard>
        </AutomationCard>
      ) : null}

      {pfs && pform ? (
        <AutomationCard
          title="Waiting for payment → free listing"
          channelId="payment_followup"
          description="A seller went over the free listings of the month, saw the payment and stopped. They get payment reminders; if they still don't pay, one email offers THAT listing for free (a gift that builds trust), with a limit per person so waiting doesn't become the way to skip paying."
          enabled={pfs.enabled} enabledAt={pfs.enabledAt} busy={busy.pay}
          onToggle={togglePay} dirty={pDirty || !pf.setUp}
          onSave={() => run('pay', 'save', () => put('pay', pPatch(), pf.setUp ? 'Changes saved.' : 'Saved — the gift email was created (Templates).'))}
          footnote={`Only listings saved after it is switched on. Stops the moment they pay. While this is on, "Listing not published" doesn't send its payment message. Daytime only.${pf.setUp ? '' : ' Not set up for this country yet: saving creates it and the gift email.'}${pStats ? ` ${pStats}.` : ''}`}
        >
          <StepCard n={1} kind="Trigger" title="A listing is saved over the free limit and not paid" />
          <Connector />
          <StepCard n={2} kind="Reminders" title="Payment reminders, after the listing was saved">
            <DraftSteps steps={pform.steps} errors={e8} onChange={(list) => setPform((f) => ({ ...f, steps: list }))}
              note="Each reminder goes once per listing (up to 5), only while it is still unpaid — e.g. 1, 3 and 7 days." />
            <TemplatePicker label="Reminder email" value={pform.reminderTemplateId} templates={data.templates} onChange={(v) => setPform((f) => ({ ...f, reminderTemplateId: v }))} error={e8.reminderTemplateId} />
          </StepCard>
          <Connector />
          <StepCard n={3} kind="Gift" title="Still not paid: publish THAT listing for free">
            <DayField value={pform.giftAfterDays} onChange={(v) => setPform((f) => ({ ...f, giftAfterDays: v }))} min={0} max={60} error={e8.giftAfterDays} suffix="days after it was saved" />
            <p className="text-[11px]" style={{ color: T.textMuted }}>{pGift ? `${pform.giftAfterDays} days after it was saved, if still unpaid: ONE email with a button that publishes that listing for free (only that seller, only that listing; valid 14 days). After it, no more reminders.` : '0 = no gift: reminders only. Set the days (after the last reminder, e.g. 8) to send this email.'}</p>
            <div style={{ opacity: pGift ? 1 : 0.55 }}>
              <TemplatePicker label={pGift ? 'Gift email' : 'Gift email (not sent while the days are 0)'} value={pform.giftTemplateId} templates={data.templates} onChange={(v) => setPform((f) => ({ ...f, giftTemplateId: v }))} error={e8.giftTemplateId} />
            </div>
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>Always by email (there is no WhatsApp template for the gift yet), even when Send by is WhatsApp.</p>
            {pGift && <DayField value={pform.giftDays} onChange={(v) => setPform((f) => ({ ...f, giftDays: v }))} min={1} max={365} error={e8.giftDays} suffix="days live (then it ends like a paid one)" />}
          </StepCard>
          <Connector />
          <StepCard n={4} kind="Limit" title="How many free gifts one person can get">
            <div className="flex flex-wrap items-center gap-2">
              <DayField value={pform.giftsPerPerson} onChange={(v) => setPform((f) => ({ ...f, giftsPerPerson: v }))} min={1} max={100} error={e8.giftsPerPerson} suffix={Number(pform.giftsPerPerson) === 1 ? 'gift' : 'gifts'} />
              <select value={pform.giftWindowDays} onChange={(e) => setPform((f) => ({ ...f, giftWindowDays: Number(e.target.value) }))} aria-label="Gift limit period"
                className="px-2 py-1.5 rounded-[10px] border text-[13px] font-medium outline-none focus:border-ink/60" style={{ borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary, background: T.bgWhite }}>
                {[[0, 'ever'], [30, 'every 30 days'], [90, 'every 90 days'], [180, 'every 6 months'], [365, 'every year']].map(([d, l]) => <option key={d} value={d}>{l}</option>)}
              </select>
            </div>
            <p className="text-[11px] leading-snug" style={{ color: T.textMuted }}>
              Per person = their account plus any listing with the same phone. Over the limit, later listings only get the reminders — so a seller can&apos;t wait out every listing to get it free. Open and taken gifts count; an offer that expired untaken doesn&apos;t.
            </p>
          </StepCard>
        </AutomationCard>
      ) : null}
    </div>
  );
}
