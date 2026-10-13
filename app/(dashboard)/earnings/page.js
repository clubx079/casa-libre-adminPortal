'use client';
// Earnings — what Casa Libre earns from sellers in the country picked in the admin's
// country switcher: LISTING FEES (an extra listing past the free monthly ones, a 30-day
// extension) and ADD-ONS for visibility (Verified, Home page, renewals). Our own record of
// every transaction: who, what, at what price, paid or failed. Filters: period, source,
// product, grouping, status, search; CSV export. lib/earnings.js does the maths.
import { useEffect, useMemo, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, fmtDate } from '@/components/automations/ui';
import { PRODUCTS, SOURCES, sourceOf, periodRange, previousRange, filterRows, totals, productTable, series, topSellers, change, toCsv } from '@/lib/earnings';

const usd = (n) => `US$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(Number(n)) ? 0 : 2, maximumFractionDigits: 2 })}`;
const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela' };
const PRODUCT_SHADE = { 'Extra listing': '#111111', 'Listing extension': '#5B5852', Verified: '#2A5B8A', 'Home page': '#0F6E56', Renewal: '#8A5A12' };
const PERIODS = [['month', 'This month'], ['last_month', 'Last month'], ['7d', 'Last 7 days'], ['30d', 'Last 30 days'], ['90d', 'Last 90 days'], ['year', 'This year'], ['all', 'All time'], ['custom', 'Custom dates']];
const label = (key, group) => {
  try {
    if (group === 'month') return new Date(`${key}-01T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
    return new Date(`${key}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch { return key; }
};

function Select({ value, onChange, options, testid }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} data-testid={testid}
      className="text-[13px] font-medium px-3 py-2 rounded-full border bg-white outline-none" style={{ borderColor: T.borderLight, color: T.textBody }}>
      {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  );
}

function Kpi({ label: l, value, hint, delta, testid }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD} data-testid={testid}>
      <div className="text-[11px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>{l}</div>
      <div className="text-[24px] font-bold tracking-head mt-1" style={{ color: T.textPrimary }}>{value}</div>
      <div className="text-[11.5px] mt-0.5 flex items-center gap-1.5" style={{ color: T.textSecondary }}>
        {delta != null && <span className="font-semibold" style={{ color: delta >= 0 ? T.success : T.danger }}>{delta >= 0 ? '▲' : '▼'} {Math.abs(delta)}%</span>}
        {hint}
      </div>
    </div>
  );
}

// Stacked bars, one per bucket, split by product.
function Chart({ data, group }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  if (!data.length) return <p className="text-[13px]" style={{ color: T.textMuted }}>No earnings in this period.</p>;
  return (
    <div>
      <div className="flex items-end gap-1 h-[180px] overflow-x-auto pb-1" data-testid="earn-chart">
        {data.map((d) => (
          <div key={d.key} className="flex-1 min-w-[14px] max-w-[48px] h-full flex flex-col justify-end" title={`${label(d.key, group)}: ${usd(d.total)}`}>
            {PRODUCTS.map((p) => d.byProduct[p] > 0 && <div key={p} style={{ height: `${(d.byProduct[p] / max) * 100}%`, background: PRODUCT_SHADE[p] }} className="w-full" />)}
            {d.total === 0 && <div className="w-full h-[2px]" style={{ background: T.borderLight }} />}
          </div>
        ))}
      </div>
      <div className="flex gap-1 mt-1 overflow-hidden">
        {data.map((d, i) => <div key={d.key} className="flex-1 min-w-[14px] max-w-[48px] text-[9.5px] text-center truncate" style={{ color: T.textMuted }}>{data.length <= 14 || i % Math.ceil(data.length / 12) === 0 ? label(d.key, group) : ''}</div>)}
      </div>
      <div className="flex flex-wrap gap-3 mt-3">
        {PRODUCTS.map((p) => <span key={p} className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: T.textSecondary }}><span className="w-2.5 h-2.5 rounded-sm" style={{ background: PRODUCT_SHADE[p] }} />{p}</span>)}
      </div>
    </div>
  );
}

function Bar({ name, value, total, shade }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-center justify-between text-[13px]"><span style={{ color: T.textBody }}>{name}</span><span className="font-semibold tabular-nums">{usd(value)} <span className="font-normal" style={{ color: T.textMuted }}>· {pct}%</span></span></div>
      <div className="h-2 rounded-full mt-1" style={{ background: T.bgSurface }}><div className="h-2 rounded-full" style={{ width: `${pct}%`, background: shade || T.textPrimary }} /></div>
    </div>
  );
}

export default function EarningsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [period, setPeriod] = useState('all');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [source, setSource] = useState('all');
  const [product, setProduct] = useState('all');
  const [group, setGroup] = useState('month');
  const [status, setStatus] = useState('all');
  const [q, setQ] = useState('');
  const [pageN, setPageN] = useState(0);

  useEffect(() => { fetch('/api/earnings').then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setData(j))).catch((e) => setErr(String(e))); }, []);
  useEffect(() => { setPageN(0); }, [period, custom, source, product, status, q]);

  const v = useMemo(() => {
    if (!data) return null;
    const range = periodRange(period, new Date(), custom);
    const base = { source, product };
    const inRange = filterRows(data.rows, { ...base, ...range });
    const prev = previousRange(range);
    return {
      t: totals(inRange), p: prev ? totals(filterRows(data.rows, { ...base, ...prev })) : null,
      table: productTable(inRange), chart: series(inRange, group, range), top: topSellers(inRange, 8),
      list: filterRows(inRange, { q }).filter((r) => status === 'all' || r.status === status),
    };
  }, [data, period, custom, source, product, group, status, q]);

  if (err) return <Banner>{err}</Banner>;
  if (!v) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading earnings…</div>;
  const { t, p } = v;
  const PER = 25;
  const pages = Math.max(1, Math.ceil(v.list.length / PER));
  const shown = v.list.slice(pageN * PER, pageN * PER + PER);
  const country = COUNTRY_NAME[data.country] || String(data.country || '').toUpperCase();
  const download = () => {
    const blob = new Blob([toCsv(v.list)], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `casa-libre-earnings-${data.country}-${period}.csv`; a.click(); URL.revokeObjectURL(a.href);
  };

  return (
    <div className="space-y-6" data-testid="earnings-page">
      <PageHeader title="Earnings" sub={`${country} — money earned from sellers: listing fees and visibility add-ons, in US$ (switch country at the top to see another)`} />

      {/* Filters */}
      <div className="rounded-[14px] p-4 flex flex-wrap items-center gap-2" style={CARD} data-testid="earn-filters">
        <Select value={period} onChange={setPeriod} options={PERIODS} testid="f-period" />
        {period === 'custom' && (
          <>
            <input type="date" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} className="text-[13px] px-3 py-1.5 rounded-full border" style={{ borderColor: T.borderLight }} />
            <span className="text-[12px]" style={{ color: T.textMuted }}>to</span>
            <input type="date" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} className="text-[13px] px-3 py-1.5 rounded-full border" style={{ borderColor: T.borderLight }} />
          </>
        )}
        <Select value={source} onChange={(s) => { setSource(s); setProduct('all'); }} options={[['all', 'All sources'], ...Object.keys(SOURCES).map((s) => [s, s])]} testid="f-source" />
        <Select value={product} onChange={setProduct} options={[['all', 'All products'], ...PRODUCTS.filter((x) => source === 'all' || SOURCES[source].includes(x)).map((x) => [x, x])]} testid="f-product" />
        <Select value={group} onChange={setGroup} options={[['day', 'Chart by day'], ['week', 'Chart by week'], ['month', 'Chart by month']]} testid="f-group" />
        <span className="ml-auto"><Pill tone="ink">{country}</Pill></span>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        <Kpi testid="k-earned" label="Earned" value={usd(t.earned)} delta={p ? change(t.earned, p.earned) : null} hint={p ? 'vs previous period' : null} />
        <Kpi testid="k-payments" label="Paid transactions" value={t.payments} delta={p ? change(t.payments, p.payments) : null} hint={`avg ${usd(t.average)}`} />
        <Kpi testid="k-sellers" label="Paying sellers" value={t.sellers} hint="different accounts that paid" />
        <Kpi testid="k-failed" label="Failed payments" value={t.failed} hint={t.successRate != null ? `${t.successRate}% succeeded${t.failed ? ` · ${usd(t.failedAmount)} not charged` : ''}` : 'no attempts'} />
      </div>

      {/* What was bought */}
      <div className="rounded-[14px] p-5" style={CARD} data-testid="earn-products-table">
        <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>What sellers paid for</div>
        {v.table.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>No transactions in this period.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}>
                <th className="py-2 pr-3 font-medium">Product</th><th className="py-2 pr-3 font-medium">Source</th><th className="py-2 pr-3 font-medium text-right">Price</th>
                <th className="py-2 pr-3 font-medium text-right">Paid</th><th className="py-2 pr-3 font-medium text-right">Failed</th><th className="py-2 pr-3 font-medium text-right">Sellers</th><th className="py-2 font-medium text-right">Earned</th>
              </tr></thead>
              <tbody>
                {v.table.map((x) => (
                  <tr key={`${x.product}${x.price}`} className="border-t" style={{ borderColor: T.borderLight }}>
                    <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: PRODUCT_SHADE[x.product] }} />{x.product}</span></td>
                    <td className="py-2 pr-3" style={{ color: T.textSecondary }}>{x.source}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{usd(x.price)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{x.paid}</td>
                    <td className="py-2 pr-3 text-right tabular-nums" style={{ color: x.failed ? T.danger : T.textMuted }}>{x.failed}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{x.users}</td>
                    <td className="py-2 text-right font-semibold tabular-nums">{usd(x.earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Over time + split */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-[14px] p-5 lg:col-span-2" style={CARD}>
          <div className="text-[15px] font-bold mb-4" style={{ color: T.textPrimary }}>Earnings over time</div>
          <Chart data={v.chart} group={group} />
        </div>
        <div className="rounded-[14px] p-5 space-y-3" style={CARD} data-testid="earn-sources">
          <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>By source</div>
          {Object.keys(SOURCES).map((s) => <Bar key={s} name={s} value={t.bySource[s]} total={t.earned} />)}
          <div className="pt-2 space-y-3 border-t" style={{ borderColor: T.borderLight }}>
            {PRODUCTS.map((x) => <Bar key={x} name={x} value={t.byProduct[x]} total={t.earned} shade={PRODUCT_SHADE[x]} />)}
          </div>
          <p className="text-[11.5px] leading-snug" style={{ color: T.textMuted }}>Listing fees = extra listings past the free monthly ones + 30-day extensions. Add-ons = Verified, Home page and their renewals.</p>
        </div>
      </div>

      {/* Top sellers */}
      <div className="rounded-[14px] p-5" style={CARD} data-testid="earn-top">
        <div className="text-[15px] font-bold mb-3" style={{ color: T.textPrimary }}>Top paying sellers</div>
        {v.top.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>None in this period.</p> : (
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: T.textMuted }}><th className="py-2 pr-3 font-medium">Seller</th><th className="py-2 pr-3 font-medium text-right">Payments</th><th className="py-2 font-medium text-right">Spent</th></tr></thead>
            <tbody>{v.top.map((s) => <tr key={s.email || s.name} className="border-t" style={{ borderColor: T.borderLight }}><td className="py-2 pr-3">{s.email || s.name || '—'}</td><td className="py-2 pr-3 text-right tabular-nums">{s.payments}</td><td className="py-2 text-right font-semibold tabular-nums">{usd(s.total)}</td></tr>)}</tbody>
          </table>
        )}
      </div>

      {/* Transactions */}
      <div className="rounded-[14px] p-5" style={CARD} data-testid="earn-transactions">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="text-[15px] font-bold mr-auto" style={{ color: T.textPrimary }}>All transactions <span className="text-[12px] font-normal" style={{ color: T.textMuted }}>({v.list.length})</span></div>
          <Select value={status} onChange={setStatus} options={[['all', 'Paid + failed'], ['succeeded', 'Paid only'], ['failed', 'Failed only']]} testid="f-status" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search seller, listing…" className="text-[13px] px-3 py-1.5 rounded-full border outline-none w-[200px]" style={{ borderColor: T.borderLight }} data-testid="f-search" />
          <button onClick={download} className="text-[12.5px] font-semibold px-3.5 py-1.5 rounded-full border" style={{ borderColor: T.textPrimary }} data-testid="earn-csv">Export CSV</button>
        </div>
        {shown.length === 0 ? <p className="text-[13px]" style={{ color: T.textMuted }}>No transactions match.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead><tr className="text-left" style={{ color: T.textMuted }}>
                <th className="py-2 pr-3 font-medium">Date</th><th className="py-2 pr-3 font-medium">Seller</th><th className="py-2 pr-3 font-medium">Listing</th>
                <th className="py-2 pr-3 font-medium">What</th><th className="py-2 pr-3 font-medium text-right">Price</th><th className="py-2 pr-3 font-medium">Status</th><th className="py-2 font-medium">Card</th>
              </tr></thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={r.id} className="border-t" style={{ borderColor: T.borderLight }} data-testid="earn-row">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.created_at, true)}</td>
                    <td className="py-2 pr-3">{r.email || '—'}{r.name && <div className="text-[10.5px]" style={{ color: T.textMuted }}>{r.name}</div>}</td>
                    <td className="py-2 pr-3 truncate max-w-[180px]">{r.listing || '—'}</td>
                    <td className="py-2 pr-3"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: PRODUCT_SHADE[r.product] }} />{r.product}</span><div className="text-[10.5px]" style={{ color: T.textMuted }}>{sourceOf(r.product)}</div></td>
                    <td className="py-2 pr-3 text-right tabular-nums font-semibold">{usd(r.amount_usd)}</td>
                    <td className="py-2 pr-3">{r.status === 'succeeded' ? <Pill tone="success">Paid</Pill> : <span title={r.failure || ''}><Pill tone="danger">Failed{r.failure ? ` · ${r.failure}` : ''}</Pill></span>}</td>
                    <td className="py-2 text-[12px]" style={{ color: T.textSecondary }}>{r.card || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="flex items-center justify-end gap-2 mt-3 text-[12.5px]">
            <button disabled={pageN === 0} onClick={() => setPageN((n) => n - 1)} className="px-3 py-1 rounded-full border disabled:opacity-40" style={{ borderColor: T.borderLight }}>Previous</button>
            <span style={{ color: T.textMuted }}>{pageN + 1} / {pages}</span>
            <button disabled={pageN >= pages - 1} onClick={() => setPageN((n) => n + 1)} className="px-3 py-1 rounded-full border disabled:opacity-40" style={{ borderColor: T.borderLight }}>Next</button>
          </div>
        )}
      </div>
    </div>
  );
}
