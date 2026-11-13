'use client';
// Search Console — how the active country's site does in Google search: clicks, impressions,
// CTR and average position (with the change against the previous period), a daily chart of clicks
// and of impressions, the keywords we rank for, top pages, devices, countries, sitemaps and an
// index check. Data: /api/search-console (lib/searchConsole.js), read-only. Google's numbers are
// final about 2 days after the day, so every period ends 2 days ago.
import { useEffect, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill } from '@/components/automations/ui';

const COUNTRY_NAME = { py: 'Paraguay', bo: 'Bolivia', uy: 'Uruguay', ve: 'Venezuela', sv: 'El Salvador' };
const RANGES = [[7, '7 days'], [28, '28 days'], [90, '90 days']];
const CLICK = '#2563B0';
const IMPR = '#7A8A99';
const DEVICE = { MOBILE: 'Phone', DESKTOP: 'Computer', TABLET: 'Tablet' };
const CC3 = { pry: 'Paraguay', bol: 'Bolivia', ury: 'Uruguay', ven: 'Venezuela', slv: 'El Salvador', arg: 'Argentina', bra: 'Brazil', usa: 'United States', esp: 'Spain', chl: 'Chile', col: 'Colombia', per: 'Peru', mex: 'Mexico', pak: 'Pakistan', deu: 'Germany' };

const num = (n) => Math.round(Number(n || 0)).toLocaleString('en-US');
const pct = (n) => `${(Number(n || 0) * 100).toFixed(1)}%`;
const pos = (n) => (n ? Number(n).toFixed(1) : '—');
const dayLabel = (k) => { try { return new Date(`${k}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch { return k; } };
const pathOf = (u) => { try { const x = new URL(u); return decodeURIComponent(x.pathname + x.search) || '/'; } catch { return u; } };

function change(cur, prev, { lowerIsBetter = false, ratio = false } = {}) {
  if (!prev) return null;
  const d = ratio ? (cur - prev) * 100 : ((cur - prev) / prev) * 100;
  if (!Number.isFinite(d) || Math.abs(d) < 0.05) return { text: 'no change', tone: T.textMuted };
  const good = lowerIsBetter ? d < 0 : d > 0;
  return { text: `${d > 0 ? '+' : ''}${d.toFixed(1)}${ratio ? ' pts' : '%'} vs previous`, tone: good ? T.success : T.danger };
}

function Kpi({ label, value, delta, hint }) {
  return (
    <div className="rounded-[14px] p-4" style={CARD}>
      <div className="text-[12px] font-medium" style={{ color: T.textMuted }}>{label}</div>
      <div className="text-[26px] font-bold tabular-nums mt-1" style={{ color: T.textPrimary }}>{value}</div>
      {delta && <div className="text-[12px] mt-0.5" style={{ color: delta.tone }}>{delta.text}</div>}
      {hint && <div className="text-[11.5px] mt-1" style={{ color: T.textMuted }}>{hint}</div>}
    </div>
  );
}

// One measure per chart (no second axis): clicks, then impressions.
function Bars({ title, daily, field, color }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...daily.map((d) => d[field]));
  const total = daily.reduce((n, d) => n + d[field], 0);
  const h = hover != null ? daily[hover] : null;
  const step = Math.max(1, Math.ceil(daily.length / 8));
  return (
    <div className="rounded-[14px] p-5" style={CARD}>
      <div className="flex items-baseline justify-between mb-2">
        <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>{title}</div>
        <div className="text-[12.5px] tabular-nums" style={{ color: T.textSecondary }}>{h ? <><b style={{ color: T.textPrimary }}>{dayLabel(h.key)}</b> · {num(h[field])}</> : `Total ${num(total)}`}</div>
      </div>
      <div className="flex items-end gap-[2px] h-[140px] border-b" style={{ borderColor: T.borderLight }} role="img" aria-label={`${title} per day`}>
        {daily.map((d, i) => (
          <div key={d.key} className="flex-1 min-w-[3px] h-full flex flex-col justify-end" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} title={`${dayLabel(d.key)}: ${num(d[field])}`}>
            {d[field] > 0 && <div style={{ height: `${(d[field] / max) * 100}%`, minHeight: 2, background: color, borderRadius: '4px 4px 0 0', opacity: hover == null || hover === i ? 1 : 0.5 }} />}
          </div>
        ))}
      </div>
      <div className="flex gap-[2px] mt-1">
        {daily.map((d, i) => <div key={d.key} className="flex-1 min-w-[3px] text-[9.5px] text-center whitespace-nowrap overflow-visible" style={{ color: T.textMuted }}>{i % step === 0 ? dayLabel(d.key) : ''}</div>)}
      </div>
    </div>
  );
}

const th = 'py-2 pr-3 font-medium';
const thr = `${th} text-right`;
const td = 'py-2 pr-3 text-right tabular-nums';

function Table({ title, rows, first, firstLabel, empty = 'No data for this period.', note }) {
  return (
    <div className="rounded-[14px] p-5" style={CARD}>
      <div className="text-[15px] font-bold mb-1" style={{ color: T.textPrimary }}>{title}</div>
      {note && <p className="text-[12px] mb-2" style={{ color: T.textMuted }}>{note}</p>}
      {!rows.length ? <p className="text-[13px]" style={{ color: T.textMuted }}>{empty}</p> : (
        <div className="overflow-x-auto max-h-[460px] overflow-y-auto">
          <table className="w-full text-[13px]">
            <thead className="sticky top-0" style={{ background: '#fff' }}><tr className="text-left" style={{ color: T.textMuted }}><th className={th}>{firstLabel}</th><th className={thr}>Clicks</th><th className={thr}>Impressions</th><th className={thr}>CTR</th><th className="py-2 font-medium text-right">Avg. position</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t" style={{ borderColor: T.borderLight }}>
                  <td className="py-2 pr-3 break-all" style={{ color: T.textBody }}>{first(r)}</td>
                  <td className={td}>{num(r.clicks)}</td><td className={td}>{num(r.impressions)}</td><td className={td}>{pct(r.ctr)}</td>
                  <td className="py-2 text-right tabular-nums">{pos(r.position)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function IndexCard({ sitemaps }) {
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const run = (method) => {
    setBusy(true); setErr('');
    fetch('/api/search-console/index', { method, cache: 'no-store' }).then((r) => r.json())
      .then((j) => (j.error ? setErr(j.error) : setRes(j))).catch((e) => setErr(String(e))).finally(() => setBusy(false));
  };
  // Runs on its own when the page opens (the result is cached 12 h on the server, so a reload is instant).
  useEffect(() => { run('GET'); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const submitted = sitemaps.reduce((n, s) => n + s.submitted, 0);
  return (
    <div className="rounded-[14px] p-5" style={CARD} data-testid="gsc-index">
      <div className="text-[15px] font-bold mb-1" style={{ color: T.textPrimary }}>Indexed pages</div>
      <p className="text-[12px] mb-3" style={{ color: T.textMuted }}>
        Google does not give the total of indexed pages through its API. We check a random sample of 40 pages from the sitemap with Google&apos;s URL Inspection tool and estimate the total from it.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <div><div className="text-[12px]" style={{ color: T.textMuted }}>Pages in the sitemap (Google)</div><div className="text-[20px] font-bold tabular-nums">{num(submitted)}</div></div>
        <div><div className="text-[12px]" style={{ color: T.textMuted }}>Sample checked</div><div className="text-[20px] font-bold tabular-nums">{res ? `${res.indexed} / ${res.checked}` : '—'}</div></div>
        <div><div className="text-[12px]" style={{ color: T.textMuted }}>Indexed share</div><div className="text-[20px] font-bold tabular-nums">{res ? pct(res.share) : '—'}</div></div>
        <div><div className="text-[12px]" style={{ color: T.textMuted }}>Estimated indexed pages</div><div className="text-[20px] font-bold tabular-nums">{res ? `≈ ${num(res.estimatedIndexed)}` : '—'}</div></div>
      </div>
      <div className="flex items-center gap-3">
        <button type="button" onClick={() => run('POST')} disabled={busy} className="px-4 py-2 rounded-full text-[13px] font-semibold disabled:opacity-60" style={{ background: T.textPrimary, color: '#fff' }}>
          {busy ? 'Checking 40 pages with Google… (about a minute)' : 'Check again'}
        </button>
        {res && <span className="text-[12px]" style={{ color: T.textMuted }}>Checked {new Date(res.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {num(res.inSitemap)} pages read from the live sitemap</span>}
      </div>
      {err && <p className="text-[12.5px] mt-2" style={{ color: T.danger }}>{err}</p>}
      {res?.notIndexed?.length > 0 && (
        <details className="mt-3">
          <summary className="text-[12.5px] cursor-pointer" style={{ color: T.textSecondary }}>Sample pages not indexed ({res.notIndexed.length})</summary>
          <ul className="mt-2 space-y-1">
            {res.notIndexed.map((r) => <li key={r.url} className="text-[12px] break-all" style={{ color: T.textBody }}>{pathOf(r.url)} <span style={{ color: T.textMuted }}>· {r.coverage || r.verdict}</span></li>)}
          </ul>
        </details>
      )}
      {sitemaps.length > 0 && (
        <div className="mt-4 text-[12px]" style={{ color: T.textSecondary }}>
          {sitemaps.map((s) => (
            <div key={s.path}>Sitemap {pathOf(s.path)} · {num(s.submitted)} pages · last read by Google {s.lastDownloaded ? dayLabel(s.lastDownloaded.slice(0, 10)) : '—'}{s.errors ? ` · ${s.errors} errors` : ''}{s.warnings ? ` · ${s.warnings} warnings` : ''}</div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function SearchConsolePage() {
  const [days, setDays] = useState(28);
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let cancelled = false;
    setData(null); setErr('');
    fetch(`/api/search-console?days=${days}`, { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (!cancelled) (j.error ? setErr(j.error) : setData(j)); })
      .catch((e) => { if (!cancelled) setErr(String(e)); });
    return () => { cancelled = true; };
  }, [days]);

  const country = data ? (COUNTRY_NAME[data.country] || String(data.country || '').toUpperCase()) : '';
  return (
    <div className="space-y-6" data-testid="search-console-page">
      <PageHeader
        title="Search Console"
        sub={`${country ? `${country} — ` : ''}how the site does in Google search: clicks, impressions, the keywords we rank for and indexed pages. Google's numbers are about 2 days behind. Switch country at the top to see another site.`}
        action={country ? <Pill tone="ink">{country}</Pill> : null}
      />
      <div className="flex gap-2">
        {RANGES.map(([d, l]) => (
          <button key={d} type="button" onClick={() => setDays(d)} className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold border" style={days === d ? { background: T.textPrimary, color: '#fff', borderColor: T.textPrimary } : { color: T.textSecondary, borderColor: T.borderLight }}>{l}</button>
        ))}
      </div>

      {err && <Banner>{err}</Banner>}
      {!err && !data && <div className="text-[13px]" style={{ color: T.textMuted }}>Loading Search Console…</div>}
      {data && !data.access && (
        <Banner tone="warning">Our Google account has no access to this country&apos;s Search Console property ({(data.tried || []).join(' or ')}). Add the account omar@airosofts.com to the property in Search Console, then reload.</Banner>
      )}
      {data?.access && (
        <>
          <div className="text-[12.5px]" style={{ color: T.textMuted }}>{dayLabel(data.period.start)} – {dayLabel(data.period.end)} · property {data.property}</div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3" data-testid="gsc-kpis">
            <Kpi label="Clicks" value={num(data.totals.clicks)} delta={change(data.totals.clicks, data.previous.clicks)} />
            <Kpi label="Impressions" value={num(data.totals.impressions)} delta={change(data.totals.impressions, data.previous.impressions)} />
            <Kpi label="CTR" value={pct(data.totals.ctr)} delta={change(data.totals.ctr, data.previous.ctr, { ratio: true })} />
            <Kpi label="Average position" value={pos(data.totals.position)} delta={change(data.totals.position, data.previous.position, { lowerIsBetter: true })} hint="Lower is better (1 = top of Google)" />
          </div>
          <div className="grid lg:grid-cols-2 gap-4">
            <Bars title="Clicks per day" daily={data.daily} field="clicks" color={CLICK} />
            <Bars title="Impressions per day" daily={data.daily} field="impressions" color={IMPR} />
          </div>
          <Table title="Keywords we rank for" note="The searches that showed the site in Google, top 50 by clicks, with an English translation." rows={data.queries} first={(r) => (<><span>{r.key}</span>{r.en && r.en.toLowerCase() !== String(r.key).toLowerCase() && <span className="block text-[12px] italic" style={{ color: T.textMuted }}>{r.en}</span>}</>)} firstLabel="Search (English below)" />
          <Table title="Top pages" rows={data.pages} first={(r) => pathOf(r.key)} firstLabel="Page" />
          <div className="grid lg:grid-cols-2 gap-4">
            <Table title="Devices" rows={data.devices} first={(r) => DEVICE[r.key] || r.key} firstLabel="Device" />
            <Table title="Where searchers are" rows={data.countries} first={(r) => CC3[r.key] || String(r.key || '').toUpperCase()} firstLabel="Country" />
          </div>
          <IndexCard sitemaps={data.sitemaps || []} />
        </>
      )}
    </div>
  );
}
