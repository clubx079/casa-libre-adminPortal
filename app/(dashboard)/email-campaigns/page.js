// Email & WhatsApp campaigns: every automated message we send, grouped by what it is for, with
// sent / opened / clicked (email) and sent / read / clicked (WhatsApp), and this week against the
// week before. Data: lib/messageCampaignsData.js (email_log + Resend + PostHog), active country.
import Link from 'next/link';
import { activeCountry } from '@/lib/adminCountry';
import { campaignsFor, RANGES } from '@/lib/messageCampaignsData';
import { GROUPS } from '@/lib/messageCampaigns';
import { Card, CardLink, WeekChange, RateChange } from '@/components/AdminCard';
import PreviewButton from '@/components/CampaignPreview';

export const dynamic = 'force-dynamic';

const NAMES = { py: 'Paraguay', uy: 'Uruguay', bo: 'Bolivia', ve: 'Venezuela', sv: 'El Salvador' };
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'));
const rate = (v) => (v == null ? '—' : `${v}%`);
const ago = (iso) => {
  const d = Date.now() - Date.parse(iso);
  if (!Number.isFinite(d)) return '';
  if (d < 3600000) return `${Math.max(1, Math.round(d / 60000))} min ago`;
  if (d < 86400000) return `${Math.round(d / 3600000)} h ago`;
  return `${Math.round(d / 86400000)} d ago`;
};

function Metric({ label, value, sub, change }) {
  return (
    <div className="min-w-0">
      <p className="text-[12px] text-ink/55">{label}</p>
      <p className="text-[24px] leading-tight font-bold tabular-nums text-ink mt-0.5">{value}</p>
      <p className="text-[11.5px] text-ink/45 mt-0.5 flex flex-wrap gap-x-1.5">{change}{sub ? <span>{sub}</span> : null}</p>
    </div>
  );
}

function Totals({ t, range }) {
  const e = t.email; const w = t.wa;
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
      <Card title="Email" sub={`Campaign emails, last ${range} days. Changes compare the last 7 days with the 7 before.`}>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Metric label="Sent" value={fmt(e.range.sent)} change={<WeekChange now={e.w.sent} before={e.p.sent} />} sub={`${fmt(e.w.sent)} this week`} />
          <Metric label="Open rate" value={rate(e.range.openRate)} change={<RateChange now={e.w.openRate} before={e.p.openRate} />} sub={`${fmt(e.range.opened)} opened`} />
          <Metric label="Click rate" value={rate(e.range.clickRate)} change={<RateChange now={e.w.clickRate} before={e.p.clickRate} />} sub={`${fmt(e.range.clicked)} clicked`} />
          <Metric label="Bounced" value={fmt(e.range.failed)} change={<WeekChange now={e.w.failed} before={e.p.failed} invert />} />
        </div>
      </Card>
      <Card title="WhatsApp" sub={`Automation and campaign messages, last ${range} days. Changes compare the last 7 days with the 7 before.`}>
        <div className="p-5 grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Metric label="Sent" value={fmt(w.range.sent)} change={<WeekChange now={w.w.sent} before={w.p.sent} />} sub={`${fmt(w.w.sent)} this week`} />
          <Metric label="Read rate" value={rate(w.range.readRate)} change={<RateChange now={w.w.readRate} before={w.p.readRate} />} sub={`${fmt(w.range.read)} read`} />
          <Metric label="Tapped a button" value={fmt(w.range.clicked)} change={<WeekChange now={w.w.clicked} before={w.p.clicked} />} sub="people" />
          <Metric label="Failed" value={fmt(w.range.failed)} change={<WeekChange now={w.w.failed} before={w.p.failed} invert />} />
        </div>
      </Card>
    </div>
  );
}

function Row({ c }) {
  const hasEmail = c.email.sent > 0 || c.week.email.p.sent > 0;
  const hasWa = c.wa.sent > 0 || c.week.wa.p.sent > 0;
  return (
    <tr className="border-b border-ink/10 last:border-b-0 align-top">
      <th scope="row" className="text-left font-normal px-5 py-3.5 w-[34%] min-w-[260px]">
        <div className="flex items-baseline gap-2 flex-wrap">
          <PreviewButton campKey={c.key} subject={hasEmail ? '' : (c.subjects[0]?.subject || '')} title={c.label}
            className="text-left text-[13.5px] font-semibold text-ink underline decoration-ink/20 underline-offset-2 hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink rounded-sm">
            {c.label}
          </PreviewButton>
          {c.lastAt ? <span className="text-[11.5px] text-ink/40">last sent {ago(c.lastAt)}</span> : null}
          {c.href ? <Link href={c.href} className="text-[11.5px] text-ink/45 hover:text-ink underline decoration-ink/15 underline-offset-2">Manage</Link> : null}
        </div>
        <p className="text-[12px] text-ink/55 mt-0.5">{c.about}</p>
        {c.subjects.length ? (
          <details className="mt-1.5 group">
            <summary className="text-[12px] font-medium text-ink/60 cursor-pointer select-none hover:text-ink">What we sent ({c.subjects.length}): click one to see it</summary>
            <ul className="mt-1.5 space-y-1">
              {c.subjects.map((s) => (
                <li key={s.subject} className="text-[12px] text-ink/70 flex gap-2">
                  <span className="tabular-nums text-ink/40 w-8 shrink-0 text-right">{s.n}×</span>
                  <PreviewButton campKey={c.key} subject={s.subject} title={c.label}
                    className="min-w-0 break-words text-left underline decoration-ink/15 underline-offset-2 hover:text-ink hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink rounded-sm">
                    {s.subject}
                  </PreviewButton>
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </th>
      <td className="px-3 py-3.5 text-right tabular-nums whitespace-nowrap">{hasEmail ? fmt(c.email.sent) : <span className="text-ink/25">—</span>}</td>
      <td className="px-3 py-3.5 text-right tabular-nums whitespace-nowrap">{hasEmail && !c.noRates ? rate(c.email.openRate) : <span className="text-ink/25">—</span>}</td>
      <td className="px-3 py-3.5 text-right tabular-nums whitespace-nowrap">{hasEmail && !c.noRates ? rate(c.email.clickRate) : <span className="text-ink/25">—</span>}</td>
      <td className="px-3 py-3.5 text-right tabular-nums whitespace-nowrap border-l border-ink/10">{hasWa ? fmt(c.wa.sent) : <span className="text-ink/25">—</span>}</td>
      <td className="px-3 py-3.5 text-right tabular-nums whitespace-nowrap">{hasWa ? rate(c.wa.readRate) : <span className="text-ink/25">—</span>}</td>
      <td className="px-3 py-3.5 text-right tabular-nums whitespace-nowrap">{hasWa ? fmt(c.wa.clicked) : <span className="text-ink/25">—</span>}</td>
      <td className="px-5 py-3.5 text-right whitespace-nowrap border-l border-ink/10">
        <div className="tabular-nums text-[13px] text-ink">{fmt(c.week.email.w.sent + c.week.wa.w.sent)} <span className="text-ink/40 text-[12px]">vs {fmt(c.week.email.p.sent + c.week.wa.p.sent)}</span></div>
        <WeekChange now={c.week.email.w.sent + c.week.wa.w.sent} before={c.week.email.p.sent + c.week.wa.p.sent} />
      </td>
    </tr>
  );
}

export default async function EmailCampaignsPage({ searchParams }) {
  const cc = activeCountry();
  const range = RANGES.includes(Number(searchParams?.days)) ? Number(searchParams.days) : 30;
  let data = null; let err = null;
  try { data = await campaignsFor(cc, range); } catch (e) { err = String(e?.message || e).slice(0, 200); }

  return (
    <div className="max-w-[1320px] space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[28px] font-bold tracking-head text-ink">Email &amp; WhatsApp campaigns</h1>
          <p className="text-[13.5px] text-ink/55 mt-0.5">Every message our automations send in {NAMES[cc] || cc.toUpperCase()}, grouped by what it is for.</p>
        </div>
        <nav aria-label="Period" className="inline-flex rounded-full border border-ink/15 bg-white p-1">
          {RANGES.map((d) => (
            <Link key={d} href={`/email-campaigns?days=${d}`} aria-current={d === range ? 'page' : undefined}
              className={`px-3.5 py-1.5 rounded-full text-[12.5px] font-medium ${d === range ? 'bg-ink text-paper' : 'text-ink/65 hover:bg-ink/5'}`}>
              Last {d} days
            </Link>
          ))}
        </nav>
      </header>

      {err ? <div className="rounded-[14px] px-4 py-3 text-[13px]" style={{ background: '#FBEDE9', color: '#8A2B16' }}>Couldn&apos;t load the campaigns: {err}</div> : null}

      {data ? (
        <>
          <Totals t={data.totals} range={range} />

          <nav aria-label="Jump to a group" className="flex flex-wrap gap-2">
            {GROUPS.filter((g) => data.campaigns.some((c) => c.group === g.key)).map((g) => (
              <a key={g.key} href={`#g-${g.key}`} className="px-3 py-1.5 rounded-full border border-ink/12 bg-white text-[12.5px] font-medium text-ink/70 hover:text-ink hover:border-ink/30">
                {g.label} <span className="text-ink/40">{data.campaigns.filter((c) => c.group === g.key).length}</span>
              </a>
            ))}
          </nav>

          {GROUPS.map((g) => {
            const list = data.campaigns.filter((c) => c.group === g.key);
            if (!list.length) return null;
            return (
              <Card key={g.key} id={`g-${g.key}`} title={g.label} sub={g.about}
                aside={g.key === 'team' ? <CardLink href="/campaigns">WhatsApp Marketing</CardLink> : g.key === 'site' ? null : <CardLink href="/automations">Automations</CardLink>}>
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[900px]">
                    <thead>
                      <tr className="text-[12px] text-ink/50 whitespace-nowrap border-b border-ink/10">
                        <th scope="col" rowSpan={2} className="text-left font-medium px-5 py-2">Campaign</th>
                        <th scope="colgroup" colSpan={3} className="font-semibold text-ink/70 px-3 pt-2 text-right">Email</th>
                        <th scope="colgroup" colSpan={3} className="font-semibold text-ink/70 px-3 pt-2 text-right border-l border-ink/10">WhatsApp</th>
                        <th scope="col" rowSpan={2} className="font-medium px-5 py-2 text-right border-l border-ink/10">Last 7 days<br />vs 7 before</th>
                      </tr>
                      <tr className="text-[12px] text-ink/50 whitespace-nowrap border-b border-ink/10">
                        <th scope="col" className="font-medium px-3 pb-2 text-right">Sent</th>
                        <th scope="col" className="font-medium px-3 pb-2 text-right">Opened</th>
                        <th scope="col" className="font-medium px-3 pb-2 text-right">Clicked</th>
                        <th scope="col" className="font-medium px-3 pb-2 text-right border-l border-ink/10">Sent</th>
                        <th scope="col" className="font-medium px-3 pb-2 text-right">Read</th>
                        <th scope="col" className="font-medium px-3 pb-2 text-right">Tapped</th>
                      </tr>
                    </thead>
                    <tbody>{list.map((c) => <Row key={c.key} c={c} />)}</tbody>
                  </table>
                </div>
              </Card>
            );
          })}

          <div className="text-[12px] text-ink/50 space-y-1">
            <p>Opened and clicked are shares of the emails Resend could track. Read is a share of the WhatsApp messages delivered. Tapped counts people who tapped a button, from the site&apos;s visit tracking.</p>
            <p>Not here: replies the Inbox assistant writes in a conversation, and notices sent to the team.</p>
            {data.notes.map((n) => <p key={n}>{n}</p>)}
          </div>
        </>
      ) : null}
    </div>
  );
}
