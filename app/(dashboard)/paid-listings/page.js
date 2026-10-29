'use client';
// Paid listings — the free-listings limit and the price of extra listings, for the active
// country. The buyer portal applies it (publish + hourly cron); this page sets it and shows
// what is happening: this month's numbers, listings waiting for payment / paid / ended, and
// accounts that look like the same person, and the people who started paying but didn't
// finish (with the pay-screen funnel). Settings: lib/paidListingsAdmin.js.
import { useEffect, useMemo, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, fmtDate, inputCls, btnPrimary } from '@/components/automations/ui';
import { ChannelControl } from '@/components/automations/WhatsAppChannels';
import { SIGNAL_LABEL } from '@/lib/paidListingsAdmin';
import { templateOptionLabel } from '@/lib/templateEnglish';
import { useEnglishNames } from '@/components/automations/useEnglishNames';

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

const waLink = (phone) => { const d = String(phone || '').replace(/\D/g, ''); return d.length >= 8 ? `https://wa.me/${d}` : null; };
const ago = (iso) => {
  const h = Math.round((Date.now() - Date.parse(iso)) / 3600000);
  return h < 24 ? `${h} h ago` : `${Math.round(h / 24)} d ago`;
};

// Stopped at the paywall: someone wanted to publish one more listing this month, the payment
// came up, and what happened next (lib/paywallActivity.js). Click a person → their activity.
const STOP_TONE = { waiting: 'warning', gift_open: 'info', gift_lapsed: 'neutral', gift_taken: 'success', paid: 'success', ended: 'neutral', other: 'neutral' };
const STOP_LABEL = { waiting: 'Stopped at payment', gift_open: 'Free gift offered', gift_lapsed: 'Gift not taken', gift_taken: 'Published free (gift)', paid: 'Paid', ended: 'Ended', other: '—' };
const ord = (n) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`; };
const hrs = (h) => (h == null ? '' : h < 24 ? `${h} h` : `${Math.round(h / 24)} d`);
function PaywallStops({ rows }) {
  const [only, setOnly] = useState('stopped');
  if (!rows) return null;
  const stopped = rows.filter((r) => ['waiting', 'gift_open', 'gift_lapsed'].includes(r.state));
  const list = only === 'stopped' ? stopped : rows;
  return (
    <div className="rounded-[14px] p-5" style={CARD} data-testid="paywall-stops">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>Stopped at the paywall</div>
        <div className="inline-flex rounded-[10px] p-0.5" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
          {[['stopped', `Still not paid ${stopped.length}`], ['all', `Everyone who hit it ${rows.length}`]].map(([v, l]) => (
            <button key={v} type="button" onClick={() => setOnly(v)} className="px-3 py-1 rounded-[8px] text-[12.5px]" style={only === v ? { background: '#fff', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: T.textSecondary }}>{l}</button>
          ))}
        </div>
      </div>
      <p className="text-[12.5px] mt-1 mb-4" style={{ color: T.textSecondary }}>People who wanted to publish one more listing this month, saw the price and what they did next. &quot;Stopped at payment&quot; with no card form opened = they likely didn&apos;t want to pay. Last 180 days.</p>
      {list.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>{only === 'stopped' ? 'Nobody is stuck at the paywall right now.' : 'Nobody has hit the paywall yet.'}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: T.textMuted }}><th className="py-2 pr-3 font-medium">Person</th><th className="py-2 pr-3 font-medium">Wanted to publish</th><th className="py-2 pr-3 font-medium">What happened</th><th className="py-2 pr-3 font-medium">Reminders</th><th className="py-2 font-medium">When</th></tr></thead>
            <tbody>
              {list.map((r) => {
                const o = r.owner || {};
                const href = `/analytics?user=${encodeURIComponent(r.ownerId)}${o.email ? `&email=${encodeURIComponent(o.email)}` : ''}`;
                return (
                  <tr key={r.id} className="border-t align-top" style={{ borderColor: T.borderLight }} data-testid="paywall-row">
                    <td className="py-2 pr-3"><a href={href} className="font-medium underline underline-offset-2" style={{ color: T.textPrimary }}>{o.name || o.email || String(r.ownerId).slice(0, 8)}</a>{o.name && o.email ? <span className="block text-[11.5px]" style={{ color: T.textMuted }}>{o.email}</span> : null}</td>
                    <td className="py-2 pr-3">
                      <span className="font-medium" style={{ color: T.textPrimary }}>Their {ord(r.nth)} listing this month</span>
                      <span className="block text-[11.5px]" style={{ color: T.textMuted }}>{r.title}{r.price ? ` · ${r.price}` : ''}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <Pill tone={STOP_TONE[r.state] || 'neutral'}>{STOP_LABEL[r.state] || r.state}</Pill>
                      <span className="block text-[11.5px] mt-1" style={{ color: T.textSecondary }}>
                        {r.state === 'waiting' ? (r.triedToPay ? 'Opened the card form, didn’t pay' : 'Didn’t open the card form — likely didn’t want to pay')
                          : r.state === 'paid' ? `Paid ${r.paidAfterH < 1 ? 'right away' : `after ${hrs(r.paidAfterH)}`}`
                            : r.state === 'gift_open' ? `Offered ${fmtDate(r.gift.offeredAt)} · open until ${fmtDate(r.gift.expiresAt)}`
                              : r.state === 'gift_taken' ? `Took the gift ${fmtDate(r.gift.claimedAt)}`
                                : r.state === 'gift_lapsed' ? `Offered ${fmtDate(r.gift.offeredAt)}, never taken` : ''}
                        {r.waitingH != null ? ` · waiting ${hrs(r.waitingH)}` : ''}
                      </span>
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{r.reminders || '—'}</td>
                    <td className="py-2 whitespace-nowrap" title={fmtDate(r.at, true)}>{ago(r.at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Started paying, didn't finish: the funnel (PostHog) + who (payments 'started' rows).
function Checkouts({ c, site }) {
  if (!c) return null;
  const f = c.funnel;
  const open = c.list.filter((x) => !x.paidLater);
  return (
    <div className="rounded-[14px] p-5" style={CARD} data-testid="checkouts">
      <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>Started paying, didn&apos;t finish</div>
      <p className="text-[12.5px] mb-4" style={{ color: T.textSecondary }}>Last {c.days} days. People who opened the card form and left without paying — a short, kind message often brings them back.</p>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 mb-4">
        <Stat label="Opened the pay screen" value={f ? f.opened : '—'} hint={f ? 'people · PostHog' : 'PostHog not connected'} />
        <Stat label="Tapped pay" value={f ? f.started : c.started} hint={f ? 'people · PostHog' : 'card forms opened'} />
        <Stat label="Paid" value={f ? f.paid : '—'} hint="people" />
        <Stat label="Didn't finish" value={c.abandoned} hint="checkouts, 1 h+ ago" />
      </div>
      {open.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>Nobody left a checkout unpaid in this period.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: T.textMuted }}><th className="py-2 pr-3 font-medium">Person</th><th className="py-2 pr-3 font-medium">For</th><th className="py-2 pr-3 font-medium">Listing</th><th className="py-2 pr-3 font-medium">When</th><th className="py-2 font-medium">Contact</th></tr></thead>
            <tbody>
              {open.map((x) => {
                const wa = waLink(x.person.phone);
                return (
                  <tr key={x.id} className="border-t" style={{ borderColor: T.borderLight }}>
                    <td className="py-2 pr-3"><span className="font-medium" style={{ color: T.textPrimary }}>{x.person.name || x.person.email || String(x.person.id).slice(0, 8)}</span>{x.person.name && x.person.email ? <span className="block text-[11.5px]" style={{ color: T.textMuted }}>{x.person.email}</span> : null}</td>
                    <td className="py-2 pr-3">{x.what} · US${x.amount.toFixed(2).replace(/\.00$/, '')}</td>
                    <td className="py-2 pr-3">{x.listing ? <a href={`${site}/propiedad/${x.listing.slug || x.listing.id}`} target="_blank" rel="noreferrer" className="underline underline-offset-2">{x.listing.title || 'Open'}</a> : '—'}</td>
                    <td className="py-2 pr-3 whitespace-nowrap" title={fmtDate(x.at, true)}>{ago(x.at)}</td>
                    <td className="py-2 whitespace-nowrap">
                      {wa ? <a href={wa} target="_blank" rel="noreferrer" className="underline underline-offset-2 mr-3">WhatsApp</a> : null}
                      {x.person.email ? <a href={`mailto:${x.person.email}`} className="underline underline-offset-2">Email</a> : null}
                      {!wa && !x.person.email ? <span style={{ color: T.textMuted }}>—</span> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function PaidListingsPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');
  const enNames = useEnglishNames(data?.templates); // pickers read "English (Spanish)"

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
      <option value="">— don’t send this email —</option>
      {data.templates.map((t) => <option key={t.id} value={t.id}>{templateOptionLabel(t.name, enNames[t.id])}{t.is_active === false ? ' (inactive)' : ''}</option>)}
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

      <PaywallStops rows={data.stops} />

      <Checkouts c={data.checkouts} site={data.site} />

      {/* Settings */}
      {/* Send the paid-listing emails by Email | WhatsApp | Both (migration 017) */}
      <div className="rounded-[14px] overflow-hidden" style={CARD}><ChannelControl id="paid_listings" /></div>

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
                  const [tone, label] = l.gift && l.state === 'active' ? ['success', 'Free gift · live'] : STATE[l.state] || ['neutral', l.state || '—'];
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
