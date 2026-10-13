'use client';
// Paid listings — the free-listings limit and the price of extra listings, for the active
// country. The buyer portal applies it (publish + hourly cron); this page sets it and shows
// what is happening: this month's numbers, listings waiting for payment / paid / ended, and
// accounts that look like the same person. Settings: lib/paidListingsAdmin.js.
import { useEffect, useMemo, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, fmtDate, inputCls, btnPrimary } from '@/components/automations/ui';
import { SIGNAL_LABEL } from '@/lib/paidListingsAdmin';

function Field({ label, help, error, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold mb-1" style={{ color: T.textPrimary }}>{label}</span>
      {children}
      {help && <span className="block text-[12px] mt-1 leading-snug" style={{ color: T.textSecondary }}>{help}</span>}
      {error && <span className="block text-[12px] mt-1 font-medium" style={{ color: T.danger }}>{error}</span>}
    </label>
  );
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[11px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[24px] font-bold tracking-head mt-1" style={{ color: T.textPrimary }}>{value}</div>
      {hint && <div className="text-[11.5px] mt-0.5" style={{ color: T.textSecondary }}>{hint}</div>}
    </div>
  );
}

const STATE = { pending: ['warning', 'Waiting for payment'], active: ['success', 'Paid · live'], expired: ['neutral', 'Ended · off the site'] };

export default function PaidListingsPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const take = (j) => {
    setData(j);
    const s = j.settings;
    setForm({ enabled: s.enabled, freePerMonth: s.freePerMonth, listPrice: s.listPrice, discountPct: s.discountPct, days: s.days, extendPrice: s.extendPrice, extendDays: s.extendDays, remindDaysBefore: s.remindDaysBefore, samePersonMin: s.samePersonMin, endingTemplateId: s.endingTemplateId || '', endedTemplateId: s.endedTemplateId || '', agentTemplateId: s.agentTemplateId || '' });
  };
  useEffect(() => {
    fetch('/api/paid-listings').then((r) => r.json()).then((j) => { if (j.error) setLoadErr(j.error); else take(j); }).catch((e) => setLoadErr(String(e)));
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e }));
  // Live preview of what the seller pays (same math as the buyer portal).
  const preview = useMemo(() => {
    if (!form) return null;
    const list = Number(String(form.listPrice).replace(',', '.'));
    const pct = Number(form.discountPct);
    if (!(list > 0) || !(pct >= 0 && pct <= 100)) return null;
    const pay = Math.round(list * (100 - pct)) / 100;
    return { list: list.toFixed(2).replace(/\.00$/, ''), pay: pay.toFixed(2).replace(/\.00$/, '') };
  }, [form]);

  const save = async (patch = {}) => {
    setBusy(true); setMsg(''); setErrors({});
    try {
      const body = { ...form, ...patch, freePerMonth: Number(form.freePerMonth), discountPct: Number(form.discountPct), days: Number(form.days), extendDays: Number(form.extendDays), remindDaysBefore: Number(form.remindDaysBefore), samePersonMin: Number(form.samePersonMin) };
      const r = await fetch('/api/paid-listings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setErrors(j.errors || {}); setMsg(j.error === 'invalid' ? 'Fix the highlighted fields.' : j.error || 'Could not save.'); return; }
      take(j); setMsg('Saved.');
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  };

  if (loadErr) return <Banner>{loadErr}</Banner>;
  if (!data || !form) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading…</div>;
  const s = data.stats;
  const n = Number(form.freePerMonth);
  const tplOptions = (cur) => (
    <>
      <option value="">— pick a template —</option>
      {data.templates.map((t) => <option key={t.id} value={t.id}>{t.name}{t.is_active === false ? ' (inactive)' : ''}</option>)}
    </>
  );

  return (
    <div className="space-y-6" data-testid="paid-listings-page">
      <PageHeader
        title="Paid listings"
        sub={`Free listings per month, and the price of extra ones — ${String(data.country || '').toUpperCase()}`}
        action={(
          <button onClick={() => save({ enabled: !form.enabled })} disabled={busy} className={btnPrimary} data-testid="paid-toggle" style={form.enabled ? {} : { background: T.success }}>
            {form.enabled ? 'Switch OFF (everything free)' : 'Switch ON'}
          </button>
        )}
      />

      {/* What it means, in one box */}
      <div className="rounded-[14px] p-5" style={{ ...CARD, background: form.enabled ? T.successSurface : T.bgSurface }} data-testid="paid-summary">
        <div className="flex items-center gap-2 mb-2">
          <Pill tone={form.enabled ? 'success' : 'neutral'}>{form.enabled ? 'ON' : 'OFF'}</Pill>
          <span className="text-[14px] font-bold" style={{ color: T.textPrimary }}>What this means right now</span>
        </div>
        {form.enabled ? (
          <ul className="text-[13px] leading-relaxed list-disc pl-5" style={{ color: T.textBody }}>
            <li>Each person can publish <b>{n} {n === 1 ? 'listing' : 'listings'} for free every month</b> (the month starts on the 1st, local time).</li>
            <li>{n === 0 ? <>Every listing is paid.</> : <>Listings 1 to {n} of the month are free. <b>Listing number {n + 1} and every one after it that month costs money</b>.</>}</li>
            <li>The seller sees <b>US${preview?.list ?? '—'}</b> crossed out, <b>{form.discountPct}% off</b>, and pays <b>US${preview?.pay ?? '—'}</b>. The listing then stays on the site for <b>{form.days} days</b>.</li>
            <li>{form.remindDaysBefore} days before the end they get an email. When the time is up the listing goes off the site and they can <b>extend it {form.extendDays} days for US${String(form.extendPrice).replace(/\.00$/, '')}</b>.</li>
            <li>One person with several emails shares one free quota: accounts are treated as the same person when <b>{form.samePersonMin} of 3</b> signals match (same device · same device profile · same Wi-Fi/network).</li>
          </ul>
        ) : (
          <p className="text-[13px]" style={{ color: T.textBody }}>The paywall is off: <b>every listing is free</b>, as before. Nothing is charged and no paid-listing emails are sent. Set the numbers below, then switch it on.</p>
        )}
      </div>

      {msg && <Banner tone={msg === 'Saved.' ? 'warning' : 'error'}>{msg}</Banner>}
      {errors.enabled && <Banner>{errors.enabled}</Banner>}

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="Free listings this month" value={s.freeThisMonth} hint="published while the paywall was on" />
        <Stat label="Paid listings this month" value={s.paidThisMonth} hint={`+ ${s.extendedThisMonth} extensions`} />
        <Stat label="Revenue this month" value={`US$${s.revenueThisMonth}`} hint={`all time US$${s.revenueAllTime}`} />
        <Stat label="Waiting for payment" value={s.pending} hint="saved, not on the site" />
        <Stat label="Paid and live" value={s.activePaid} />
        <Stat label="Ended" value={s.ended} hint="off the site until extended" />
      </div>

      {/* Settings */}
      <div className="rounded-[14px] p-5 space-y-5" style={CARD}>
        <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>Settings</div>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Free listings per month" error={errors.freePerMonth}
            help={<>How many listings one person can publish for free each calendar month. <b>{n || 0}</b> means listings 1–{n || 0} are free and listing {n + 1} asks for payment. 0 = every listing is paid. Resets on the 1st.</>}>
            <input type="number" min="0" max="1000" value={form.freePerMonth} onChange={set('freePerMonth')} className={inputCls} data-testid="f-free" />
          </Field>
          <Field label="Same person = how many signals match" error={errors.samePersonMin}
            help="Signals: the same device, the same device profile (model, screen, browser), the same Wi-Fi / network. 2 of 3 is recommended — 1 would join people who only share an office Wi-Fi.">
            <select value={form.samePersonMin} onChange={set('samePersonMin')} className={inputCls}>
              <option value={1}>1 of 3 (strict, more false matches)</option>
              <option value={2}>2 of 3 (recommended)</option>
              <option value={3}>3 of 3 (only the exact same device + network)</option>
            </select>
          </Field>
          <Field label="List price (US$, shown crossed out)" error={errors.listPrice} help="The 'normal' price shown with a line through it.">
            <input value={form.listPrice} onChange={set('listPrice')} className={inputCls} data-testid="f-list" />
          </Field>
          <Field label="Discount %" error={errors.discountPct} help={preview ? <>Seller pays <b>US${preview.pay}</b> per extra listing (US${preview.list} − {form.discountPct}%). Always charged in US$; the local price is shown in small print.</> : 'Seller pays the list price minus this %.'}>
            <input type="number" min="0" max="95" value={form.discountPct} onChange={set('discountPct')} className={inputCls} data-testid="f-discount" />
          </Field>
          <Field label="A paid listing stays live (days)" error={errors.days} help="Counted from the payment.">
            <input type="number" min="1" max="365" value={form.days} onChange={set('days')} className={inputCls} />
          </Field>
          <Field label="'Ends soon' email (days before the end)" error={errors.remindDaysBefore} help="One email with a link to extend.">
            <input type="number" min="1" max="60" value={form.remindDaysBefore} onChange={set('remindDaysBefore')} className={inputCls} />
          </Field>
          <Field label="Extension price (US$)" error={errors.extendPrice} help="To keep a paid listing up longer, or bring an ended one back.">
            <input value={form.extendPrice} onChange={set('extendPrice')} className={inputCls} />
          </Field>
          <Field label="An extension adds (days)" error={errors.extendDays}>
            <input type="number" min="1" max="365" value={form.extendDays} onChange={set('extendDays')} className={inputCls} />
          </Field>
        </div>

        <div className="grid gap-5 md:grid-cols-3 pt-2 border-t" style={{ borderColor: T.borderLight }}>
          <Field label="Email · ends soon" help="Sent before the paid time ends.">
            <select value={form.endingTemplateId} onChange={set('endingTemplateId')} className={inputCls}>{tplOptions()}</select>
          </Field>
          <Field label="Email · ended" help="Sent when it goes off the site.">
            <select value={form.endedTemplateId} onChange={set('endedTemplateId')} className={inputCls}>{tplOptions()}</select>
          </Field>
          <Field label="Email · plan for agents" help="Sent once, the first time someone hits the paywall.">
            <select value={form.agentTemplateId} onChange={set('agentTemplateId')} className={inputCls}>{tplOptions()}</select>
          </Field>
        </div>
        {!data.setUp && <p className="text-[12px]" style={{ color: T.textSecondary }}>First save creates the three emails (in Spanish) — edit their text in Email templates.</p>}
        <div className="flex items-center gap-3">
          <button onClick={() => save()} disabled={busy} className={btnPrimary} data-testid="paid-save">{busy ? 'Saving…' : 'Save settings'}</button>
          <span className="text-[12px]" style={{ color: T.textMuted }}>{data.emailsSent} paid-listing emails sent so far</span>
        </div>
      </div>

      {/* Listings */}
      <div className="rounded-[14px] p-5" style={CARD}>
        <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>Paid, waiting and ended listings</div>
        {data.listings.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}><th className="py-2 pr-3 font-medium">Listing</th><th className="py-2 pr-3 font-medium">Owner</th><th className="py-2 pr-3 font-medium">State</th><th className="py-2 pr-3 font-medium">Listed</th><th className="py-2 font-medium">Paid until</th></tr></thead>
              <tbody>
                {data.listings.map((l) => {
                  const [tone, label] = STATE[l.state] || ['neutral', l.state || '—'];
                  return (
                    <tr key={l.id} className="border-t" style={{ borderColor: T.borderLight }}>
                      <td className="py-2 pr-3">{l.title || String(l.id).slice(0, 8)}</td>
                      <td className="py-2 pr-3">{l.owner.email || l.owner.name || String(l.owner.id).slice(0, 8)}</td>
                      <td className="py-2 pr-3"><Pill tone={tone}>{label}</Pill></td>
                      <td className="py-2 pr-3">{fmtDate(l.created_at)}</td>
                      <td className="py-2">{l.until ? fmtDate(l.until) : '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Same person */}
      <div className="rounded-[14px] p-5" style={CARD} data-testid="same-person">
        <div className="text-[15px] font-bold mb-1" style={{ color: T.textPrimary }}>Same person, different emails</div>
        <p className="text-[12.5px] mb-3" style={{ color: T.textSecondary }}>Accounts whose listings came from {form.samePersonMin} of 3 matching signals (last 180 days). They share one free quota.</p>
        {data.samePerson.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>None found.</p> : (
          <div className="space-y-2.5">
            {data.samePerson.map((g, i) => (
              <div key={i} className="rounded-[12px] border px-3.5 py-2.5" style={{ borderColor: T.borderLight }}>
                <div className="text-[11.5px] mb-1.5" style={{ color: T.textSecondary }}>{g.matched.map((m) => SIGNAL_LABEL[m] || m).join(' · ')}</div>
                <div className="flex flex-wrap gap-2">
                  {g.users.map((u) => <Pill key={u.id} tone="info">{u.email || u.name || String(u.id).slice(0, 8)} · {u.freeThisMonth} this month</Pill>)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
