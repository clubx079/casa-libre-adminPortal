'use client';
// "Weekly newsletter" card on the Automations page (its own API: /api/automations/newsletter,
// lib/newsletterAdmin.js). The website's hourly cron sends it: on the chosen day and hour, the
// next newsletter of the rotation to its audience, with that week's measured numbers.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, Banner, fmtDate, btnPrimary } from '@/components/automations/ui';
import { AUDIENCES, DAYS, HOURS } from '@/lib/newsletterAdmin';

const sel = 'px-2.5 py-1.5 rounded-[10px] border text-[13px] font-medium outline-none focus:border-ink/60';
const selStyle = { borderColor: 'rgba(17,17,17,.2)', color: T.textPrimary, background: T.bgWhite };

export default function NewsletterCard() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');

  const apply = (j) => {
    setData(j);
    const s = j.settings;
    setForm({ day: s.day, hour: s.hour, next: s.next, rotation: s.rotation.map((r) => ({ ...r })) });
  };
  useEffect(() => {
    fetch('/api/automations/newsletter', { cache: 'no-store' }).then((r) => r.json()).then((j) => (j.error ? setError(j.error) : apply(j))).catch((e) => setError(String(e.message || e)));
  }, []);

  async function save(patch, ok) {
    setErrors({}); setError(''); setNotice('');
    const res = await fetch('/api/automations/newsletter', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch) });
    const j = await res.json();
    if (res.status === 400 && j.errors) { setErrors(j.errors); setError(j.errors.enabled || 'Fix the highlighted fields.'); return; }
    if (!res.ok) { setError(j.message || j.error || `HTTP ${res.status}`); return; }
    apply(j);
    setNotice(ok);
  }

  if (error && !data) return <Banner>{error}</Banner>;
  if (!data || !form) return null;
  const s = data.settings;
  const byId = new Map(data.templates.map((t) => [String(t.id), t]));
  const newsletters = data.templates.filter((t) => /^newsletter-/.test(t.key || '') || form.rotation.some((r) => r.template_id === String(t.id)));
  const dirty = JSON.stringify(form) !== JSON.stringify({ day: s.day, hour: s.hour, next: s.next, rotation: s.rotation });
  const setRow = (i, patch) => setForm((f) => ({ ...f, rotation: f.rotation.map((r, k) => (k === i ? { ...r, ...patch } : r)) }));
  const move = (i, d) => setForm((f) => { const r = [...f.rotation]; const j = i + d; if (j < 0 || j >= r.length) return f; [r[i], r[j]] = [r[j], r[i]]; return { ...f, rotation: r }; });
  const remove = (i) => setForm((f) => ({ ...f, rotation: f.rotation.filter((_, k) => k !== i), next: Math.max(0, Math.min(f.next, f.rotation.length - 2)) }));
  const add = () => { const unused = newsletters.find((t) => !form.rotation.some((r) => r.template_id === String(t.id))) || data.templates[0]; if (unused) setForm((f) => ({ ...f, rotation: [...f.rotation, { template_id: String(unused.id), audience: 'everyone' }] })); };
  const toggle = async () => {
    const on = !s.enabled;
    const when = `${DAYS[form.day]} at ${form.hour}:00 (country time)`;
    // eslint-disable-next-line no-alert
    if (!window.confirm(on
      ? `Switch the weekly newsletter on?\n\nEvery ${when} the next newsletter of the rotation goes to its audience (verified accounts that did not opt out), once per person per week. A newsletter whose numbers could not be measured that week is skipped for the next one.`
      : 'Switch the weekly newsletter off?\n\nNothing more is sent until you switch it on again.')) return;
    setBusy('toggle');
    await save(dirty ? { ...form, enabled: on } : { enabled: on }, on ? 'Weekly newsletter is on.' : 'Weekly newsletter is off.');
    setBusy('');
  };
  const weeks = Object.entries(data.perWeek || {}).sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, 4);

  return (
    <section className="rounded-[18px] overflow-hidden" style={{ background: T.bgWhite, border: `1px solid ${T.borderLight}` }}>
      <div className="flex flex-wrap items-center justify-between gap-4 px-5 md:px-6 py-5 border-b" style={{ borderColor: T.borderLight }}>
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <h2 className="text-[18px] font-bold tracking-head" style={{ color: T.textPrimary }}>Weekly newsletter</h2>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={s.enabled ? { background: T.successSurface, color: T.success } : { background: T.bgSurface, color: T.textMuted }}>{s.enabled ? 'Live' : 'Off'}</span>
          </div>
          <p className="text-[13px] mt-1" style={{ color: T.textSecondary }}>
            Once a week: a short newsletter with real Casa-Libre numbers (what buyers look at, prices, areas), tips and success stories, with buttons to list, complete the profile or get the app. Same issues as the website page <a href="https://casa-libre.com.py/newsletter" target="_blank" rel="noreferrer" className="underline">/newsletter</a>.{s.enabled && s.enabledAt ? ` On since ${fmtDate(s.enabledAt, true)}.` : ''}
          </p>
        </div>
        <button onClick={toggle} disabled={!!busy} role="switch" aria-checked={s.enabled} aria-label="Weekly newsletter: on or off"
          className="inline-flex items-center gap-3 pl-2 pr-4 py-1.5 rounded-full border text-[13px] font-semibold disabled:opacity-50"
          style={s.enabled ? { background: T.successSurface, borderColor: T.success, color: T.success } : { background: T.bgWhite, borderColor: 'rgba(17,17,17,.2)', color: T.textBody }}>
          <span className="relative w-10 h-[22px] rounded-full" style={{ background: s.enabled ? T.success : 'rgba(17,17,17,.2)' }}>
            <span className="absolute top-[3px] w-4 h-4 rounded-full bg-white shadow" style={{ left: s.enabled ? 21 : 3 }} />
          </span>
          {busy === 'toggle' ? 'Saving…' : s.enabled ? 'On' : 'Off'}
        </button>
      </div>

      <div className="p-4 md:p-5 space-y-4" style={{ background: T.bgSurface }}>
        <div className="flex flex-wrap items-center gap-2 text-[13px]" style={{ color: T.textBody }}>
          <span className="font-semibold">Send every</span>
          <select value={form.day} onChange={(e) => setForm((f) => ({ ...f, day: Number(e.target.value) }))} className={sel} style={selStyle} aria-label="Day">
            {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
          <span>at</span>
          <select value={form.hour} onChange={(e) => setForm((f) => ({ ...f, hour: Number(e.target.value) }))} className={sel} style={selStyle} aria-label="Hour">
            {Array.from({ length: HOURS.max - HOURS.min + 1 }, (_, i) => HOURS.min + i).map((h) => <option key={h} value={h}>{h}:00</option>)}
          </select>
          <span style={{ color: T.textMuted }}>country time</span>
          {errors.hour && <span style={{ color: T.danger }}>{errors.hour}</span>}
        </div>

        <div>
          <div className="text-[12px] font-semibold uppercase tracking-wide mb-2" style={{ color: T.textMuted }}>Rotation — one per week, in this order, then from the top again</div>
          <div className="flex flex-col gap-1.5">
            {form.rotation.map((r, i) => {
              const t = byId.get(r.template_id);
              return (
                <div key={i} className="flex flex-wrap items-center gap-2 px-3 py-2 rounded-[10px]" style={{ background: T.bgWhite, border: `1px solid ${i === form.next ? T.success : T.borderLight}` }}>
                  <span className="text-[12px] font-semibold w-6" style={{ color: T.textMuted }}>#{i + 1}</span>
                  <select value={r.template_id} onChange={(e) => setRow(i, { template_id: e.target.value })} className={`${sel} min-w-[220px] flex-1`} style={selStyle} aria-label={`Newsletter ${i + 1}`}>
                    {data.templates.map((x) => <option key={x.id} value={x.id}>{x.name}{x.is_active === false ? ' (off)' : ''}</option>)}
                  </select>
                  <select value={r.audience} onChange={(e) => setRow(i, { audience: e.target.value })} className={sel} style={selStyle} aria-label={`Audience ${i + 1}`}>
                    {AUDIENCES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  {i === form.next
                    ? <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: T.successSurface, color: T.success }}>Next</span>
                    : <button onClick={() => setForm((f) => ({ ...f, next: i }))} className="text-[11px] underline" style={{ color: T.textSecondary }}>Send next</button>}
                  {t && <Link href={`/email-templates/${t.id}`} className="text-[11px] underline" style={{ color: T.textSecondary }}>Edit / preview</Link>}
                  <button onClick={() => move(i, -1)} className="text-[12px] px-1" aria-label="Move up" style={{ color: T.textSecondary }}>↑</button>
                  <button onClick={() => move(i, 1)} className="text-[12px] px-1" aria-label="Move down" style={{ color: T.textSecondary }}>↓</button>
                  <button onClick={() => remove(i)} className="text-[11px] underline" style={{ color: T.danger }}>Remove</button>
                </div>
              );
            })}
          </div>
          <button onClick={add} className="mt-2 text-[12px] font-semibold underline" style={{ color: T.textBody }}>+ Add a newsletter</button>
          {errors.rotation && <p className="text-[11px] mt-1" style={{ color: T.danger }}>{errors.rotation}</p>}
          <p className="text-[11px] mt-2 leading-snug" style={{ color: T.textMuted }}>
            The numbers ({'{{nl_…}}'}) are measured on the day of sending (PostHog + this country&apos;s listings, last 30 days, rounded down). If one can&apos;t be measured honestly that week, that newsletter is skipped and the next one goes. &quot;Sellers&quot; / &quot;Buyers&quot; use the account&apos;s user type when it is set; until then, whether they ever listed.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 px-5 md:px-6 py-4 border-t" style={{ borderColor: T.borderLight }}>
        <p className="text-[12px]" style={{ color: T.textMuted }}>
          {s.issue ? `This week (${s.issue.week}): ${byId.get(String(s.issue.template_id))?.name || 'a newsletter'} → ${AUDIENCES.find((a) => a.id === s.issue.audience)?.label || s.issue.audience}${s.issue.done ? ', all sent' : ', sending'}. ` : 'Nothing sent yet. '}
          {weeks.length ? `Sent: ${weeks.map(([w, n]) => `${w} ${n}`).join(' · ')}.` : ''}
          {s.setUp ? '' : ' Not set up for this country yet: saving creates it (all newsletter templates in the rotation).'}
          {notice ? ` ${notice}` : ''}{error && data ? ` ${error}` : ''}
        </p>
        <div className="flex items-center gap-3">
          {dirty && <span className="text-[12px]" style={{ color: T.textMuted }}>Unsaved changes</span>}
          <button onClick={async () => { setBusy('save'); await save(form, 'Changes saved.'); setBusy(''); }} disabled={(!dirty && s.setUp) || !!busy} className={btnPrimary}>{busy === 'save' ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </section>
  );
}
