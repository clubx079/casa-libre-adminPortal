'use client';
// Earnings — money received (Stripe charges that succeeded), per month, product and country.
import { useEffect, useMemo, useState } from 'react';
import { T, CARD, PageHeader, Banner, fmtDate } from '@/components/automations/ui';
import { PRODUCTS } from '@/lib/earnings';

const usd = (n) => `US$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const monthName = (m) => { try { return new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }); } catch { return m; } };

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[11px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[24px] font-bold tracking-head mt-1" style={{ color: T.textPrimary }}>{value}</div>
      {hint && <div className="text-[11.5px] mt-0.5" style={{ color: T.textSecondary }}>{hint}</div>}
    </div>
  );
}

export default function EarningsPage() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [cc, setCc] = useState('all');
  useEffect(() => { fetch('/api/earnings').then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setD(j))).catch((e) => setErr(String(e))); }, []);

  // One country: the same numbers, filtered.
  const view = useMemo(() => {
    if (!d) return null;
    if (cc === 'all') return d;
    const months = d.months.map((m) => ({ ...m, total: m.byCountry[cc] || 0 })).filter((m) => m.total > 0);
    return { ...d, months, total: d.byCountry[cc] || 0, recent: d.recent.filter((r) => r.country === cc) };
  }, [d, cc]);

  if (err) return <Banner>{err}</Banner>;
  if (!view) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading…</div>;
  const thisMonth = new Date().toISOString().slice(0, 7);
  const cur = view.months.find((m) => m.month === thisMonth);

  return (
    <div className="space-y-6" data-testid="earnings-page">
      <PageHeader title="Earnings" sub="Money received from sellers — paid listings, extensions and promotions (US$)" />
      {Object.keys(d.errors || {}).length > 0 && <Banner tone="warning">Could not read: {Object.keys(d.errors).join(', ').toUpperCase()}</Banner>}

      <div className="flex items-center gap-2 flex-wrap">
        {['all', ...d.countries].map((c) => (
          <button key={c} onClick={() => setCc(c)} className="text-[13px] font-semibold px-3.5 py-1.5 rounded-full"
            style={{ background: cc === c ? T.primary : T.bgWhite, color: cc === c ? T.bgWhite : T.textBody, border: `1px solid ${cc === c ? T.primary : T.borderLight}` }}>
            {c === 'all' ? 'All countries' : c.toUpperCase()}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Stat label="This month" value={usd(cur?.total || 0)} hint={monthName(thisMonth)} />
        <Stat label="All time" value={usd(view.total)} hint={cc === 'all' ? `${d.count} payments` : null} />
        <Stat label="By country (all time)" value={d.countries.map((c) => `${c.toUpperCase()} ${usd(d.byCountry[c] || 0)}`).join(' · ')} />
      </div>

      <div className="rounded-[14px] p-5" style={CARD}>
        <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>Per month</div>
        {view.months.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>No payments yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}>
                <th className="py-2 pr-3 font-medium">Month</th>
                {cc === 'all' && PRODUCTS.map((p) => <th key={p} className="py-2 pr-3 font-medium text-right">{p}</th>)}
                <th className="py-2 font-medium text-right">Total</th>
              </tr></thead>
              <tbody>
                {view.months.map((m) => (
                  <tr key={m.month} className="border-t" style={{ borderColor: T.borderLight }}>
                    <td className="py-2 pr-3 font-semibold">{monthName(m.month)}</td>
                    {cc === 'all' && PRODUCTS.map((p) => <td key={p} className="py-2 pr-3 text-right tabular-nums">{m.byProduct[p] ? usd(m.byProduct[p]) : '—'}</td>)}
                    <td className="py-2 text-right font-bold tabular-nums">{usd(m.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="rounded-[14px] p-5" style={CARD}>
        <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>Latest payments</div>
        {view.recent.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>None yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}><th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Country</th><th className="py-2 pr-3 font-medium">What</th><th className="py-2 pr-3 font-medium">Seller</th><th className="py-2 font-medium text-right">Amount</th></tr></thead>
              <tbody>
                {view.recent.map((r) => (
                  <tr key={`${r.country}-${r.id}`} className="border-t" style={{ borderColor: T.borderLight }}>
                    <td className="py-2 pr-3">{fmtDate(r.created_at, true)}</td>
                    <td className="py-2 pr-3">{r.country.toUpperCase()}</td>
                    <td className="py-2 pr-3">{r.product}</td>
                    <td className="py-2 pr-3">{r.email || '—'}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{usd(r.amount_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
