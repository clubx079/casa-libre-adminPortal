'use client';
// Profile personalization — pricing of the seller's professional profile (photo / logo, name,
// title, company, website, confirmed WhatsApp on every listing), for the active country.
// Same style as Paid listings. The website applies it (Settings plan box, Stripe checkout,
// hiding title / company / website after a period expires); this page sets it.
// Settings: lib/profileProAdmin.js. The "Personalize your profile" emails live in Automations.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, CARD, PageHeader, Banner, Pill, inputCls, btnPrimary } from '@/components/automations/ui';

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

const money = (v) => { const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? `US$${Number.isInteger(n) ? n : n.toFixed(2)}` : '—'; };

export default function ProfileProPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const take = (j) => {
    setData(j);
    const s = j.settings;
    setForm({ enabled: s.enabled, price: s.price, renewPrice: s.renewPrice, days: s.days, firstFree: s.firstFree });
  };
  useEffect(() => {
    fetch('/api/profile-pro', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.error) setLoadErr(j.error); else take(j); }).catch((e) => setLoadErr(String(e)));
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (patch = {}) => {
    setBusy(true); setMsg(''); setErrors({});
    try {
      const body = { ...form, ...patch, days: Number(form.days), firstFree: form.firstFree === '' ? 0 : Number(form.firstFree) };
      const r = await fetch('/api/profile-pro', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) { setErrors(j.errors || {}); setMsg(j.error === 'invalid' ? 'Fix the highlighted fields.' : j.error || 'Could not save.'); return; }
      take(j); setMsg('Saved.');
    } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  };

  if (loadErr) return <Banner>{loadErr}</Banner>;
  if (!data || !form) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading…</div>;
  const s = data.stats;
  const on = data.settings.enabled;
  const free = Number(form.firstFree) || 0;

  return (
    <div className="space-y-6" data-testid="profile-pro-page">
      <PageHeader
        title="Profile personalization"
        sub={`Price of the seller's professional profile on the listings — ${String(data.country || '').toUpperCase()}`}
        action={(
          <button onClick={() => save({ enabled: !on })} disabled={busy} className={btnPrimary} data-testid="profile-pro-toggle" style={on ? {} : { background: T.success }}>
            {on ? 'Switch OFF (free for everyone)' : 'Switch ON (paid)'}
          </button>
        )}
      />

      <div className="rounded-[14px] p-5" style={{ ...CARD, background: on ? T.successSurface : T.bgSurface }} data-testid="profile-pro-summary">
        <div className="flex items-center gap-2 mb-2">
          <Pill tone={on ? 'success' : 'neutral'}>{on ? 'PAID · ON' : 'FREE · OFF'}</Pill>
          <span className="text-[14px] font-bold" style={{ color: T.textPrimary }}>What this means right now</span>
        </div>
        {on ? (
          <ul className="text-[13px] leading-relaxed list-disc pl-5" style={{ color: T.textBody }}>
            <li>A seller&apos;s <b>title, company and website</b> show on their listings only while their professional profile is active. Name and photo always show.</li>
            <li>{free > 0 ? <>The <b>first {free}</b> people to activate it get their first {data.settings.days} days <b>free</b>{s.firstFreeUsed ? ` (${s.firstFreeUsed} used so far)` : ''}. After that, </> : null}activating costs <b>{data.settings.priceLabel}</b> for <b>{data.settings.days} days</b>.</li>
            <li>When the period ends the details are hidden from the listings and the seller can <b>renew for {data.settings.renewLabel}</b> ({data.settings.days} more days) from Settings.</li>
            <li>Sellers see the price and the button in Settings → Perfil profesional. Charged in US$ by card (Stripe), like paid listings.</li>
            <li>Note: profiles already filled in before the switch was turned on are hidden until the seller activates (free while first-N slots are left).</li>
          </ul>
        ) : (
          <p className="text-[13px]" style={{ color: T.textBody }}>The professional profile is <b>free for everyone</b>, as today: every saved profile shows on the listings and nothing is charged. Set the numbers below, then switch it on when you decide to charge.</p>
        )}
      </div>

      {msg && <Banner tone={msg === 'Saved.' ? 'warning' : 'error'}>{msg}</Banner>}

      <div className="grid gap-4 md:grid-cols-4">
        <Stat label="Active profiles" value={s.active} hint="in a paid or free period" />
        <Stat label="Expired" value={s.expired} hint="details hidden until renewed" />
        <Stat label="First-N free used" value={free > 0 ? `${s.firstFreeUsed} / ${free}` : s.firstFreeUsed} />
        <Stat label="Revenue" value={`US$${s.revenue}`} hint={`${s.paid} paid periods`} />
      </div>

      <div className="rounded-[14px] p-5 space-y-5" style={CARD}>
        <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>Settings</div>
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Price (US$)" error={errors.price} help={<>What a seller pays to activate the professional profile for the period below. Any amount; <b>0</b> = the first period is free for everyone.</>}>
            <input value={form.price} onChange={set('price')} className={inputCls} data-testid="pp-price" />
          </Field>
          <Field label="Period / expiration (days)" error={errors.days} help={<>How long it stays active, e.g. 30 or 60. After that it expires: title, company and website are hidden from the listings until renewed.</>}>
            <input type="number" min="1" max="3650" value={form.days} onChange={set('days')} className={inputCls} data-testid="pp-days" />
          </Field>
          <Field label="Renewal price (US$)" error={errors.renewPrice} help={`Each period after the first (renewing early keeps the days left). Shown as ${money(form.renewPrice)} per ${form.days || '—'} days.`}>
            <input value={form.renewPrice} onChange={set('renewPrice')} className={inputCls} data-testid="pp-renew" />
          </Field>
          <Field label="First N people free (optional)" error={errors.firstFree} help="The first N sellers to activate it get their first period free (e.g. the first 100 realtors). Leave empty or 0 for none.">
            <input type="number" min="0" value={form.firstFree} onChange={set('firstFree')} className={inputCls} data-testid="pp-free" />
          </Field>
        </div>
        {!data.setUp && <p className="text-[12px]" style={{ color: T.textSecondary }}>Not set up for this country yet — saving creates the settings with the switch OFF (nothing changes for users).</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => save()} disabled={busy} className={btnPrimary} data-testid="pp-save">{busy ? 'Saving…' : 'Save settings'}</button>
          <span className="text-[12px]" style={{ color: T.textMuted }}>The &quot;Personalize your profile&quot; emails are in <Link href="/automations" className="underline">Automations</Link>; completion per user is on <Link href="/users" className="underline">Users</Link>.</span>
        </div>
      </div>
    </div>
  );
}
