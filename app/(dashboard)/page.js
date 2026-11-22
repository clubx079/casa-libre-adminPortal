// Overview: the first screen of the admin. Top to bottom:
//   the week in one sentence (visitors → opened a home → contacted a seller) for the picked country,
//   visitors per day, campaigns + listing shares (last 7 days), the newest homes owners put up (photos),
//   every country side by side, and the newest users (with their photo when they have one).
// Database parts render at once; PostHog parts stream in behind their own <Suspense>, so a slow
// PostHog never holds the page. Data: lib/overviewData.js.
import { Suspense } from 'react';
import Link from 'next/link';
import { activeCountry, filterCountriesForSession } from '@/lib/adminCountry';
import { listCountries } from '@/lib/control';
import { getSession } from '@/lib/auth';
import { week, daily, liveNow, countries, local, tzOf } from '@/lib/overviewData';
import { CountryTable } from '@/components/OverviewCountries';
import { Card, CardLink, CardNote, WeekChange, RateChange } from '@/components/AdminCard';
import { campaignsFor } from '@/lib/messageCampaignsData';
import { sharesWeek } from '@/lib/shareData';
import { listingUrl } from '@/lib/buyerSite';

export const dynamic = 'force-dynamic';

const UP = '#2F6B3A';
const DOWN = '#B23A3A';
const NAMES = { py: 'Paraguay', uy: 'Uruguay', bo: 'Bolivia', ve: 'Venezuela', sv: 'El Salvador' };
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const pctOf = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const ago = (iso) => {
  const d = Date.now() - Date.parse(iso);
  if (!Number.isFinite(d)) return '';
  if (d < 3600000) return `${Math.max(1, Math.round(d / 60000))} min ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)} h ago`;
  if (d < 7 * 86400000) return `${Math.round(d / 86400000)} d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};
const money = (p) => (p.price ? `${p.currency === 'PYG' ? '₲' : !p.currency || p.currency === 'USD' ? 'US$' : `${p.currency} `}${Number(p.price).toLocaleString('en-US')}` : 'No price');
const homeTitle = (p) => {
  const t = String(p.property_type || 'Home');
  const kind = p.listing_type === 'rent' ? 'for rent' : p.listing_type === 'sale' ? 'for sale' : '';
  return `${t.charAt(0).toUpperCase()}${t.slice(1).toLowerCase()} ${kind}`.trim();
};
const STATUS = { published: null, active: null, expired: 'Expired', payment_pending: 'Waiting for payment', scanning: 'Photo check', duplicate_review: 'Possible duplicate', rejected: 'Rejected' };

function Change({ now, before, quiet }) {
  if (now == null || before == null) return null;
  if (!before) return now ? <span className="text-[12px]" style={{ color: UP }}>none the week before</span> : null;
  const pct = Math.round(((now - before) / before) * 100);
  if (!pct) return <span className="text-[12px] text-ink/45">same as the week before</span>;
  return (
    <span className="text-[12px] font-semibold" style={{ color: pct > 0 ? UP : DOWN }}>
      {pct > 0 ? 'up' : 'down'} {Math.abs(pct)}%{quiet ? '' : ` from ${fmt(before)}`}
    </span>
  );
}

// ── the week, said in one sentence, with the funnel under it ──
async function Week({ cc, place, listingsWeek }) {
  const w = await week(cc);
  if (!w) {
    return <p className="text-[14px] text-ink/55">Visitor numbers aren&apos;t available right now (PostHog didn&apos;t answer). Everything below is from the database.</p>;
  }
  const { now, before } = w;
  const steps = [
    { label: 'Visited the site', n: now.visitors, b: before.visitors },
    { label: 'Opened a home', n: now.opened, b: before.opened, of: now.visitors },
    { label: 'Contacted a seller', n: now.contacted, b: before.contacted, of: now.opened },
  ];
  const max = Math.max(1, now.visitors);
  const N = ({ children }) => <b className="font-bold text-ink tabular-nums">{children}</b>;
  return (
    <>
      <p className="text-[15.5px] sm:text-[16.5px] leading-[1.55] text-ink/70">
        In the last 7 days <N>{fmt(now.visitors)}</N> people visited Casa Libre {place}, <N>{fmt(now.opened)}</N> opened a home
        and <N>{fmt(now.contacted)}</N> contacted a seller{listingsWeek != null ? <>; owners put up <N>{fmt(listingsWeek)}</N> {listingsWeek === 1 ? 'home' : 'homes'}</> : null}.
      </p>
      <ol className="mt-5 flex flex-col gap-4" aria-label="From visit to contact, last 7 days">
        {steps.map((s, i) => (
          <li key={s.label} className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[13px] font-semibold text-ink">{s.label}</span>
              {i ? <span className="text-[12px] text-ink/50 tabular-nums">{pctOf(s.n, s.of)}% of the step before</span> : null}
            </div>
            <div className="mt-2 h-[10px] rounded-full bg-ink/[0.07] overflow-hidden" aria-hidden>
              <div className="h-full rounded-full bg-ink" style={{ width: `${s.n ? Math.max(2, (s.n / max) * 100) : 0}%` }} />
            </div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-[15px] font-bold tabular-nums text-ink">{fmt(s.n)}</span>
              <Change now={s.n} before={s.b} />
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function WeekSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading this week's visitors">
      <div className="h-[22px] w-[80%] rounded-md bg-ink/[0.06]" />
      <div className="h-[22px] w-[50%] rounded-md bg-ink/[0.06] mt-2" />
      <div className="mt-6 flex flex-col gap-4">{[0, 1, 2].map((i) => <div key={i} className="h-[46px] rounded-md bg-ink/[0.05]" />)}</div>
    </div>
  );
}

async function Live({ cc }) {
  const n = await liveNow(cc);
  if (n == null) return null;
  return (
    <span className="inline-flex items-center gap-2 text-[13px] font-medium text-ink/70" title="Different visitors in the last 30 minutes">
      <span className="relative flex w-2.5 h-2.5" aria-hidden>
        {n > 0 ? <span className="absolute inset-0 rounded-full animate-ping motion-reduce:animate-none opacity-50" style={{ background: UP }} /> : null}
        <span className="relative w-2.5 h-2.5 rounded-full" style={{ background: n > 0 ? UP : '#C9C2B4' }} />
      </span>
      {n > 0 ? `${fmt(n)} on the site now` : 'Nobody on the site right now'}
    </span>
  );
}

// ── visitors per day, 14 days; hover a day for its numbers ──
async function Daily({ cc }) {
  const days = await daily(cc);
  const label = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  const short = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (!days?.length) return <p className="p-5 text-[13px] text-ink/50">No visitor data for these days.</p>;
  const n = days.length;
  const max = Math.max(1, ...days.map((d) => d.visitors));
  const top = Math.ceil((max * 1.12) / 50) * 50;              // a round number above the busiest day
  const X = (i) => (n === 1 ? 50 : (i / (n - 1)) * 100);
  const Y = (v) => 100 - (v / top) * 100;
  const pts = days.map((d, i) => [X(i), Y(d.visitors)]);
  const path = (from, to) => pts.slice(from, to + 1).map(([x, y], k) => `${k ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
  const split = Math.max(0, n - 8);                           // the last 7 days start after this point
  const area = `${path(0, n - 1)} L100,100 L0,100 Z`;
  const best = days.reduce((a, d) => (d.visitors > a.visitors ? d : a), days[0]);
  const weekStart = X(split + 0.5);
  return (
    <div className="p-5 flex flex-col h-full">
      <div className="flex items-center gap-4 text-[12px] text-ink/55">
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-[2px] rounded-full bg-[#B9B1A2]" aria-hidden />7 days before</span>
        <span className="inline-flex items-center gap-1.5"><span className="w-4 h-[2px] rounded-full bg-ink" aria-hidden />Last 7 days</span>
        <span className="ml-auto">Busiest: <b className="text-ink font-semibold">{short(best.date)}</b>, {fmt(best.visitors)}</span>
      </div>
      <div className="relative flex-1 min-h-[200px] mt-4 ml-9" role="img"
        aria-label={`Visitors per day: ${days.map((d) => `${label(d.date)} ${d.visitors}`).join(', ')}`}>
        {/* scale: top value and half, as light guide lines */}
        {[top, top / 2, 0].map((v) => (
          <div key={v} className="absolute left-0 right-0 border-t border-dashed border-ink/10" style={{ top: `${Y(v)}%` }}>
            <span className="absolute -left-9 -translate-y-1/2 w-7 text-right text-[11px] text-ink/40 tabular-nums">{fmt(v)}</span>
          </div>
        ))}
        <div className="absolute top-0 bottom-0 right-0 bg-ink/[0.03] rounded-[6px]" style={{ left: `${weekStart}%` }} aria-hidden />
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
          <path d={area} fill="#111" fillOpacity="0.05" />
          <path d={path(0, split)} fill="none" stroke="#B9B1A2" strokeWidth="2" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
          <path d={path(split, n - 1)} fill="none" stroke="#111" strokeWidth="2.25" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
        {days.map((d, i) => {
          const [x, y] = pts[i];
          const recent = i > split;
          const edge = i < 2 ? 'left-0' : i > n - 3 ? 'right-0' : 'left-1/2 -translate-x-1/2';
          return (
            <div key={d.date} className="group absolute top-0 bottom-0" style={{ left: `${x - 50 / (n - 1 || 1)}%`, width: `${100 / (n - 1 || 1)}%` }}>
              <div className="absolute top-0 bottom-0 left-1/2 border-l border-ink/15 hidden group-hover:block" aria-hidden />
              <span className={`absolute left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white transition-transform group-hover:scale-125 ${recent ? 'w-[9px] h-[9px] bg-ink' : 'w-[8px] h-[8px] bg-[#B9B1A2]'}`}
                style={{ top: `${y}%` }} aria-hidden />
              <div className={`pointer-events-none absolute z-10 hidden group-hover:block whitespace-nowrap rounded-[8px] bg-ink text-paper px-2.5 py-1.5 text-[11.5px] leading-snug ${edge}`}
                style={{ top: `calc(${y}% - 64px)` }}>
                <b className="block">{label(d.date)}</b>
                {fmt(d.visitors)} visitors, {fmt(d.views)} home views, {fmt(d.contacts)} contacted
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 ml-9 flex justify-between text-[11.5px] text-ink/45">
        <span>{short(days[0].date)}</span>
        <span>{short(days[split + 1]?.date || days[0].date)}</span>
        <span>Today</span>
      </div>
    </div>
  );
}

// ── Email and WhatsApp campaigns, last 7 days vs the 7 before; the whole card opens the page ──
function CampaignStat({ label, value, change }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-ink/55 truncate">{label}</p>
      <p className="text-[21px] leading-tight font-bold tabular-nums text-ink mt-0.5">{value}</p>
      <div className="min-h-[16px]">{change}</div>
    </div>
  );
}
async function Campaigns({ cc }) {
  const d = await campaignsFor(cc, 7).catch(() => null);
  if (!d) return <p className="p-5 text-[13px] text-ink/50">Campaign numbers aren&apos;t available right now.</p>;
  const { email: e, wa: w } = d.totals;
  const box = 'block p-5 hover:bg-ink/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink';
  const r = (v) => (v == null ? '—' : `${v}%`);
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 md:divide-x divide-y md:divide-y-0 divide-ink/10">
      <Link href="/email-campaigns" className={box}>
        <p className="text-[13.5px] font-semibold text-ink">Email</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <CampaignStat label="Sent" value={fmt(e.w.sent)} change={<WeekChange now={e.w.sent} before={e.p.sent} />} />
          <CampaignStat label="Opened" value={r(e.w.openRate)} change={<RateChange now={e.w.openRate} before={e.p.openRate} />} />
          <CampaignStat label="Clicked" value={r(e.w.clickRate)} change={<RateChange now={e.w.clickRate} before={e.p.clickRate} />} />
        </div>
      </Link>
      <Link href="/email-campaigns" className={box}>
        <p className="text-[13.5px] font-semibold text-ink">WhatsApp</p>
        <div className="mt-3 grid grid-cols-3 gap-3">
          <CampaignStat label="Sent" value={fmt(w.w.sent)} change={<WeekChange now={w.w.sent} before={w.p.sent} />} />
          <CampaignStat label="Read" value={r(w.w.readRate)} change={<RateChange now={w.w.readRate} before={w.p.readRate} />} />
          <CampaignStat label="Tapped a button" value={fmt(w.w.clicked)} change={<WeekChange now={w.w.clicked} before={w.p.clicked} />} />
        </div>
      </Link>
    </div>
  );
}

// ── Listing shares, last 7 days vs the 7 before; the whole card opens the Shares page ──
async function Shares({ cc }) {
  const d = await sharesWeek(cc).catch(() => null);
  if (!d) return <p className="p-5 text-[13px] text-ink/50">Share numbers aren&apos;t available right now.</p>;
  return (
    <Link href="/shares?days=7" className="block p-5 hover:bg-ink/[0.025] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ink">
      <div className="grid grid-cols-3 gap-3">
        <CampaignStat label="Visitors from shares" value={fmt(d.visitors.w)} change={<WeekChange now={d.visitors.w} before={d.visitors.p} />} />
        <CampaignStat label="Shares" value={fmt(d.shared.w)} change={<WeekChange now={d.shared.w} before={d.shared.p} />} />
        <CampaignStat label="Link clicks" value={fmt(d.clicks.w)} change={<WeekChange now={d.clicks.w} before={d.clicks.p} />} />
      </div>
    </Link>
  );
}

async function Countries({ active }) {
  const list = filterCountriesForSession(await listCountries().catch(() => []));
  if (list.length < 2) return null;
  const rows = await countries(list);
  return (
    <Card title="Every country, last 7 days" aside={<CardNote>Click a country to open it</CardNote>} className="h-full">
      <CountryTable rows={rows} active={active} />
    </Card>
  );
}

const Skel = ({ h = 180 }) => <div className="m-5 rounded-[10px] bg-ink/[0.05]" style={{ height: h }} aria-busy="true" />;

export default async function OverviewPage() {
  const cc = activeCountry();
  const tz = tzOf(cc);
  const place = NAMES[cc] ? `in ${NAMES[cc]}` : '';
  const me = getSession();
  const first = String(me?.name || '').trim().split(/\s+/)[0];
  const hour = Number(new Date().toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }));
  const hello = hour < 5 ? 'Working late' : hour < 12 ? 'Good morning' : hour < 19 ? 'Good afternoon' : 'Good evening';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz });
  const d = await local(cc);

  return (
    <div className="max-w-[1320px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div>
          <h1 className="text-[28px] font-bold tracking-head text-ink">{hello}{first && first !== 'Admin' ? `, ${first}` : ''}</h1>
          <p className="text-[13.5px] text-ink/55 mt-0.5">{NAMES[cc] || cc.toUpperCase()}, {today}</p>
        </div>
        <Suspense fallback={null}><Live cc={cc} /></Suspense>
      </header>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5 items-stretch">
        <Card title="Last 7 days" aside={<CardNote>Compared with the 7 days before</CardNote>} className="h-full">
          <div className="p-5">
            <Suspense fallback={<WeekSkeleton />}>
              <Week cc={cc} place={place} listingsWeek={d.homesWeek} />
            </Suspense>
          </div>
        </Card>
        <Card title="Visitors per day, last 14 days" aside={<CardLink href="/analytics">Open Analytics</CardLink>} className="h-full">
          <Suspense fallback={<Skel h={240} />}><Daily cc={cc} /></Suspense>
        </Card>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] gap-5 items-stretch">
        <Card title="Campaigns, last 7 days" aside={<CardLink href="/email-campaigns">All campaigns</CardLink>} className="h-full">
          <Suspense fallback={<Skel h={110} />}><Campaigns cc={cc} /></Suspense>
        </Card>
        <Card title="Shares, last 7 days" aside={<CardLink href="/shares">Listing shares</CardLink>} className="h-full">
          <Suspense fallback={<Skel h={110} />}><Shares cc={cc} /></Suspense>
        </Card>
      </div>

      <Card title="Newest homes from owners" aside={<CardLink href="/properties?kind=originals">All owner listings</CardLink>}>
        {!d.homes.length ? <p className="p-5 text-[13px] text-ink/50">No owner has listed a home in {NAMES[cc] || 'this country'} yet.</p> : (
          <ul className="p-5 flex gap-4 overflow-x-auto snap-x snap-mandatory cl-scroll" aria-label="Newest homes; scroll sideways for more">
            {d.homes.map((h) => {
              const flag = STATUS[h.status];
              return (
                <li key={h.id} className="w-[210px] shrink-0 snap-start">
                  <a href={listingUrl(cc, h.id)} target="_blank" rel="noreferrer" title="Open on the site" className="block group focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink rounded-[12px]">
                    <div className="relative aspect-[4/3] rounded-[12px] overflow-hidden bg-[#F1ECE2] border border-ink/10">
                      {h.feature_image_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={h.feature_image_url} alt="" loading="lazy" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03] motion-reduce:transition-none" />
                        : <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink/40">No photo</span>}
                      {flag ? <span className="absolute left-2 top-2 rounded-full bg-white/95 px-2 py-0.5 text-[11px] font-semibold text-[#8A5A00]">{flag}</span> : null}
                    </div>
                    <p className="mt-2 text-[13px] font-semibold text-ink truncate">{homeTitle(h)}</p>
                    <p className="text-[12px] text-ink/55 truncate">{h.neighborhood || h.city || 'No area'}</p>
                    <p className="text-[12.5px] font-semibold text-ink tabular-nums truncate">{money(h)}</p>
                    <p className="text-[11.5px] text-ink/45">{ago(h.created_at)}</p>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] gap-5 items-stretch">
        <Suspense fallback={<Card title="Every country, last 7 days" className="h-full"><Skel h={260} /></Card>}>
          <Countries active={cc} />
        </Suspense>

        <Card title="Newest users" aside={<CardLink href="/users">All users</CardLink>} className="h-full">
          {!d.users.length ? <p className="p-5 text-[13px] text-ink/50">Nobody has signed up yet.</p> : (
            <ul>
              <li className="flex items-center justify-between px-5 h-[44px] border-b border-ink/10 text-[12px] font-medium text-ink/50" aria-hidden>
                <span>Name</span><span>Signed up</span>
              </li>
              {d.users.slice(0, 5).map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-5 h-[56px] border-b border-ink/10 last:border-b-0">
                  {u.photo
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={u.photo} alt="" loading="lazy" className="w-9 h-9 shrink-0 rounded-full object-cover bg-[#F1ECE2]" />
                    : <span className="w-9 h-9 shrink-0 rounded-full bg-[#ECE6DA] text-ink/70 flex items-center justify-center text-[13px] font-bold">{(u.full_name || u.email || '?').trim().charAt(0).toUpperCase()}</span>}
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-semibold text-ink truncate">{u.full_name || u.email || 'No name'}</p>
                    <p className="text-[11.5px] text-ink/50 truncate">{u.email || 'Signed up by phone'}</p>
                  </div>
                  <span className="text-[11.5px] text-ink/45 shrink-0">{ago(u.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
