'use client';
// The building blocks of the Automations page cards (moved out of app/(dashboard)/automations/page.js
// so self-contained cards such as ShareCards.js draw the same steps, pickers and switch).
import Link from 'next/link';
import { T, fmtDate, btnPrimary } from '@/components/automations/ui';
import { DRAFT_STEPS } from '@/lib/automationAdmin';
import { templateOptionLabel, fixedEnglish } from '@/lib/templateEnglish';
import { useEnglishNames } from '@/components/automations/useEnglishNames';
import { ChannelControl } from '@/components/automations/WhatsAppChannels';

// One step of the flow: a numbered card. Kind sets the label above the title.
export function StepCard({ n, kind, title, children }) {
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
export function Connector() {
  return (
    <div className="flex items-center justify-center shrink-0 lg:w-6 h-6 lg:h-auto" aria-hidden="true">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="rotate-90 lg:rotate-0">
        <path d="M5 12h14" /><path d="m13 6 6 6-6 6" />
      </svg>
    </div>
  );
}

// "#1–30 → 30 days · next 20 → 20 days · … · after that → 7 days" — add / remove rows.
export function TierList({ tiers, later, errors, onChange, onLater }) {
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

export function DayField({ value, onChange, min, max, error, suffix }) {
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
export function DraftSteps({ steps, errors, onChange, note, max = DRAFT_STEPS.max, min = 1, label = 'Reminder' }) {
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
            <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{label} {i + 1}</p>
            {steps.length > 1 && (
              <button type="button" onClick={() => remove(i)} aria-label={`Remove reminder ${i + 1}`} className="w-6 h-6 rounded-full text-[14px] leading-none hover:bg-black/5" style={{ color: T.textMuted }}>×</button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px]" style={{ color: T.textSecondary }}>after</span>
            <input type="number" min={min} max={s.unit === 'days' ? 60 : 1440} value={s.value} aria-label={`${label} ${i + 1}: wait`}
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
      {steps.length < max && (
        <button type="button" onClick={add} className="w-full py-2 rounded-[10px] border border-dashed text-[13px] font-semibold hover:bg-black/[.03]" style={{ borderColor: 'rgba(17,17,17,.25)', color: T.textBody }}>+ Add {label.toLowerCase()}</button>
      )}
      <p className="text-[11px]" style={{ color: T.textMuted }}>{note || <>Counted from the last time the seller opened or changed the draft. Each reminder goes once per draft (up to {DRAFT_STEPS.max}); coming back to the draft pushes the next one back.</>}</p>
    </div>
  );
}

// Pick the template an email step sends; shows its subject and an Edit link.
// Options read "English (Spanish)" — the emails themselves go out in Spanish.
export function TemplatePicker({ label, value, templates, onChange, error }) {
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
export function AutomationCard({ title, description, enabled, enabledAt, busy, onToggle, dirty, onSave, footnote, channelId, children }) {
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

