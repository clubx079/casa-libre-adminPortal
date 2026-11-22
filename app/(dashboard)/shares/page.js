// Listing shares: owners (and buyers) sharing listings on WhatsApp, Instagram, Facebook… from the
// website and the app. Active country, last 7 / 30 / 90 days: share sheet opens, shares by
// channel, link clicks, the visits those links bring (utm_medium=share) and what those visitors
// did (contacted a seller, signed up), this week vs the week before; the most-shared listings,
// the sellers who share most, and the share rewards granted. Data: lib/shareData.js.
import Link from 'next/link';
import { activeCountry } from '@/lib/adminCountry';
import { sharesFor } from '@/lib/shareData';
import { SHARE_RANGES } from '@/lib/shareStats';
import { shareRewardText } from '@/lib/shareAdmin';
import { listingUrl } from '@/lib/buyerSite';
import { Card, CardLink, CardNote, WeekChange } from '@/components/AdminCard';

export const dynamic = 'force-dynamic';

const NAMES = { py: 'Paraguay', uy: 'Uruguay', bo: 'Bolivia', ve: 'Venezuela', sv: 'El Salvador' };
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : '—');
const ago = (iso) => {
  const d = Date.now() - Date.parse(iso);
  if (!Number.isFinite(d)) return '';
  if (d < 3600000) return `${Math.max(1, Math.round(d / 60000))} min ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)} h ago`;
  return `${Math.round(d / 86400000)} d ago`;
};

function Metric({ label, value, w, p, sub }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-ink/55">{label}</p>
      <p className="text-[24px] leading-tight font-bold tabular-nums text-ink mt-0.5">{fmt(value)}</p>
      <p className="text-[11.5px] text-ink/45 mt-0.5 flex flex-wrap gap-x-1.5">
        {w != null ? <><WeekChange now={w} before={p} /><span>{fmt(w)} this week vs {fmt(p)}</span></> : null}
        {sub ? <span>{sub}</span> : null}
      </p>
    </div>
  );
}

function Channels({ rows }) {
  if (!rows.length) return <p className="p-5 text-[13px] text-ink/50">Nobody shared a listing in this period yet.</p>;
  const max = Math.max(1, ...rows.map((r) => Math.max(r.shared, r.visitors)));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-ink/10 text-[12px] text-ink/50">
            <th scope="col" className="text-left font-medium px-5 py-2.5">Channel</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5">Sheet opens</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5">Shares</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5">Link clicks</th>
            <th scope="col" className="text-right font-medium px-3 py-2.5">Visitors</th>
            <th scope="col" className="font-medium px-5 py-2.5 w-[30%] min-w-[140px]"><span className="sr-only">Bar</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} className="border-b border-ink/10 last:border-b-0">
              <th scope="row" className="text-left font-semibold text-ink px-5 py-2.5 whitespace-nowrap">{r.label}</th>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.opened)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.shared)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums">{fmt(r.clicks)}</td>
              <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{fmt(r.visitors)}</td>
              <td className="px-5 py-2.5">
                <div className="flex flex-col gap-1" aria-hidden>
                  <div className="h-[6px] rounded-full bg-ink" style={{ width: `${(r.shared / max) * 100}%`, minWidth: r.shared ? 3 : 0 }} title="Shares" />
                  <div className="h-[6px] rounded-full bg-[#B9B1A2]" style={{ width: `${(r.visitors / max) * 100}%`, minWidth: r.visitors ? 3 : 0 }} title="Visitors" />
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-5 py-2.5 text-[11.5px] text-ink/45 border-t border-ink/10 flex gap-4">
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-[6px] rounded-full bg-ink" aria-hidden />Shares</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-3 h-[6px] rounded-full bg-[#B9B1A2]" aria-hidden />Visitors from the links</span>
      </p>
    </div>
  );
}

function Listings({ rows, cc }) {
  if (!rows.length) return <p className="p-5 text-[13px] text-ink/50">No listing was shared in this period.</p>;
  return (
    <ul className="p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {rows.map((l, i) => (
        <li key={l.id} className="min-w-0">
          <a href={listingUrl(cc, l.id)} target="_blank" rel="noreferrer" title="Open on the site" className="block group rounded-[12px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
            <div className="relative aspect-[4/3] rounded-[12px] overflow-hidden bg-[#F1ECE2] border border-ink/10">
              {l.photo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={l.photo} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                : <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink/40">No photo</span>}
              <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-bold text-ink tabular-nums">#{i + 1}</span>
            </div>
            <p className="mt-2 text-[13px] font-semibold text-ink truncate">{l.title}</p>
          </a>
          <p className="text-[12px] text-ink/55 truncate">
            {l.owner ? <span title={l.ownerEmail || ''}>{l.owner}</span> : 'Owner unknown'}
          </p>
          <p className="text-[12px] text-ink tabular-nums mt-0.5">
            <b>{fmt(l.shares)}</b> {l.shares === 1 ? 'share' : 'shares'} · <b>{fmt(l.clicks)}</b> {l.clicks === 1 ? 'click' : 'clicks'}
            <span className="text-ink/45"> · {fmt(l.opens)} sheet opens</span>
          </p>
        </li>
      ))}
    </ul>
  );
}

function Sellers({ rows }) {
  if (!rows.length) return <p className="p-5 text-[13px] text-ink/50">No seller shared a listing in this period.</p>;
  return (
    <ul>
      <li className="flex items-center gap-3 px-5 h-[40px] border-b border-ink/10 text-[12px] font-medium text-ink/50" aria-hidden>
        <span className="flex-1">Seller</span><span className="w-[70px] text-right">Shared</span><span className="w-[80px] text-right">All shares</span><span className="w-[60px] text-right">Clicks</span>
      </li>
      {rows.map((s) => (
        <li key={s.ownerId} className="flex items-center gap-3 px-5 h-[56px] border-b border-ink/10 last:border-b-0">
          {s.photo
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={s.photo} alt="" loading="lazy" className="w-9 h-9 shrink-0 rounded-full object-cover bg-[#F1ECE2]" />
            : <span className="w-9 h-9 shrink-0 rounded-full bg-[#ECE6DA] text-ink/70 flex items-center justify-center text-[13px] font-bold">{(s.name || '?').trim().charAt(0).toUpperCase()}</span>}
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-semibold text-ink truncate" title={s.email || ''}>{s.name}</p>
            <p className="text-[11.5px] text-ink/50 truncate">{s.email ? `${s.email} · ` : ''}{s.listings} {s.listings === 1 ? 'listing' : 'listings'} shared</p>
          </div>
          <span className="w-[70px] text-right tabular-nums text-[13px] font-semibold">{fmt(s.ownShares)}</span>
          <span className="w-[80px] text-right tabular-nums text-[13px]">{fmt(s.shares)}</span>
          <span className="w-[60px] text-right tabular-nums text-[13px]">{fmt(s.clicks)}</span>
        </li>
      ))}
    </ul>
  );
}

function Rewards({ r, settings }) {
  const cfg = settings.reward;
  return (
    <div className="p-5 space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <Metric label="Rewards granted" value={r?.range ?? null} w={r?.w} p={r?.p} />
        <div className="min-w-0 text-[12.5px] text-ink/60 max-w-[520px]">
          <p>
            <b className={cfg.enabled ? 'text-[#2F6B3A]' : 'text-ink/60'}>{cfg.enabled ? 'Share reward is on' : 'Share reward is off'}</b>
            {cfg.setUp || cfg.enabled ? `: ${shareRewardText(cfg)}.` : ' (not set up for this country yet).'}
          </p>
          <p className="mt-0.5">Share nudge emails: <b>{settings.nudge.enabled ? 'on' : 'off'}</b>. Change both in <Link href="/automations#share" className="underline">Automations</Link>.</p>
        </div>
      </div>
      {r?.recent?.length ? (
        <ul className="border-t border-ink/10 pt-3 space-y-1.5">
          {r.recent.map((x, i) => (
            <li key={`${x.at}-${i}`} className="text-[12.5px] text-ink/70 flex flex-wrap gap-x-2">
              <span className="font-semibold text-ink">{x.name || 'A seller'}</span>
              {x.listingTitle ? <span>· {x.listingTitle}</span> : null}
              <span className="text-ink/40">{ago(x.at)}</span>
            </li>
          ))}
        </ul>
      ) : <p className="text-[12.5px] text-ink/50">{r ? 'No reward granted in this period.' : 'The reward log could not be read.'}</p>}
    </div>
  );
}

export default async function SharesPage({ searchParams }) {
  const cc = activeCountry();
  const range = SHARE_RANGES.includes(Number(searchParams?.days)) ? Number(searchParams.days) : 30;
  let d = null; let err = null;
  try { d = await sharesFor(cc, range); } catch (e) { err = String(e?.message || e).slice(0, 200); }

  return (
    <div className="max-w-[1320px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-head text-ink">Listing shares</h1>
          <p className="text-[13.5px] text-ink/55 mt-0.5">People sharing Casa-Libre listings from the website and the app in {NAMES[cc] || cc.toUpperCase()}, and what those links bring in.</p>
        </div>
        <nav aria-label="Period" className="inline-flex rounded-full border border-ink/15 bg-white p-1">
          {SHARE_RANGES.map((n) => (
            <Link key={n} href={`/shares?days=${n}`} aria-current={n === range ? 'page' : undefined}
              className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-medium ${n === range ? 'bg-ink text-paper' : 'text-ink/65 hover:bg-ink/5'}`}>
              {n} days
            </Link>
          ))}
        </nav>
      </header>

      {err ? <p className="rounded-[14px] px-4 py-3 text-[13px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>Couldn&apos;t load the shares: {err}</p> : null}
      {d && !d.posthog ? <p className="rounded-[14px] px-4 py-3 text-[13px] bg-[#F5EAD5] text-ink/80">PostHog is not connected here, so only the rewards below are shown.</p> : null}
      {d?.missing?.length && d.posthog ? <p className="text-[12.5px] text-ink/50">Some numbers did not load from PostHog this time ({d.missing.join(', ')}); they show as 0. Reload in a minute.</p> : null}

      {d ? (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
            <Card title="Sharing" sub={`Last ${range} days. Changes compare the last 7 days with the 7 before.`}>
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Metric label="Share sheet opened" value={d.opened.range} w={d.opened.w} p={d.opened.p} sub={`${fmt(d.opened.people)} people`} />
                <Metric label="Shares" value={d.shared.range} w={d.shared.w} p={d.shared.p} sub={`${pct(d.shared.range, d.opened.range)} of opens`} />
                <Metric label="Link clicks" value={d.clicks.range} w={d.clicks.w} p={d.clicks.p} />
              </div>
            </Card>
            <Card title="What the links bring in" sub={`People who arrived through a share link (utm_medium=share), last ${range} days.`}>
              <div className="p-5 grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Metric label="Visitors from shares" value={d.visitors.range} w={d.visitors.w} p={d.visitors.p} sub={`${fmt(d.visitors.visits)} page views`} />
                <Metric label="Contacted a seller" value={d.contacts.range} w={d.contacts.w} p={d.contacts.p} sub={`${pct(d.contacts.range, d.visitors.range)} of visitors`} />
                <Metric label="Signed up" value={d.signups.range} w={d.signups.w} p={d.signups.p} sub={`${pct(d.signups.range, d.visitors.range)} of visitors`} />
              </div>
            </Card>
          </div>

          <Card title="Shares by channel" aside={<CardNote>Sheet opens and shares from the share sheet; visitors from the link&apos;s utm_source</CardNote>}>
            <Channels rows={d.channels} />
          </Card>

          <Card title="Most-shared listings" aside={<CardLink href="/properties?kind=originals">All owner listings</CardLink>}>
            <Listings rows={d.listings} cc={cc} />
          </Card>

          <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] gap-5 items-stretch">
            <Card title="Sellers who share the most" aside={<CardNote>Shared = shares they made themselves</CardNote>} className="h-full">
              <Sellers rows={d.sellers} />
            </Card>
            <Card title="Share rewards" aside={<CardLink href="/automations#share">Settings</CardLink>} className="h-full">
              <Rewards r={d.rewards} settings={d.settings} />
            </Card>
          </div>
          <p className="text-[11.5px] text-ink/40">PostHog, same filters as Analytics (no Pakistan, only this country&apos;s site, website and app). Contacts and sign-ups count people who came through a share link in the period and contacted a seller / signed up in the period. Team and test accounts are left out of the listings and sellers.</p>
        </>
      ) : null}
    </div>
  );
}
