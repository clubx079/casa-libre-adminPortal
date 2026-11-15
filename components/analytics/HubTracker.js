'use client';

// Analytics → Hub tracker: the casa-libre.com hub (umbrella site + blog, ES/EN/PT, every
// country). PostHog events with hub_site set (or host casa-libre.com / www.casa-libre.com);
// they are left out of every country-site number (lib/analyticsSite.js 'hub').
// Data: /api/analytics/hub?days=… (lib/hubAnalytics.js). Mirrors Admin → Funnels → Analytics.
import { useEffect, useState } from 'react';
import { T, CARD, Banner } from '@/components/automations/ui';
import { rangeLabel } from '@/lib/analyticsRange';

const n = (v) => Number(v || 0).toLocaleString('en-US');
const pct = (a, b) => (b ? `${Math.round((a / b) * 1000) / 10}%` : '—');
const LANG_NAME = { es: 'Spanish (ES)', en: 'English (EN)', pt: 'Portuguese (PT)' };
const CC = (c) => (c && c !== '—' && c !== 'other' ? String(c).toUpperCase() : c === 'other' ? 'Other / unknown' : '—');

function Stat({ label, value, hint, tone }) {
  return (
    <div className="bg-white px-4 py-3" style={CARD}>
      <p className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: T.textSecondary }}>{label}</p>
      <p className="text-[22px] font-bold mt-0.5" style={{ color: tone || T.textPrimary }}>{value}</p>
      {hint ? <p className="text-[11px] mt-0.5 leading-snug" style={{ color: T.textMuted }}>{hint}</p> : null}
    </div>
  );
}

function MiniBars({ daily }) {
  const max = Math.max(1, ...daily.map((d) => d.visitors));
  return (
    <div>
      <div className="flex items-end gap-[3px] h-[120px]">
        {daily.map((d) => (
          <div key={d.date} className="flex-1 flex flex-col justify-end h-full relative"
            title={`${d.date}: ${d.visitors} visitors · ${d.pageviews} page views · ${d.articleViews} article views · ${d.sends} clicks to country sites`}>
            <div className="rounded-t-[3px]" style={{ height: `${(d.visitors / max) * 100}%`, minHeight: d.visitors ? 2 : 0, background: T.textPrimary }} />
            {d.sends ? <div className="absolute left-0 right-0 -top-1 mx-auto w-1.5 h-1.5 rounded-full" style={{ background: T.success }} /> : null}
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[10.5px] mt-1" style={{ color: T.textMuted }}>
        <span>{daily[0]?.date}</span><span>{daily[daily.length - 1]?.date}</span>
      </div>
    </div>
  );
}

function Table({ head, rows, empty = 'No data in this period.' }) {
  return (
    <table className="w-full">
      <thead><tr>{head.map((h, i) => <th key={i} className={`px-3 py-2 text-[10px] font-semibold uppercase tracking-wider ${i ? 'text-right' : 'text-left'}`} style={{ color: T.textSecondary, background: T.bgSurface }}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length ? rows.map((r, i) => (
          <tr key={i} className="border-b" style={{ borderColor: T.borderLight }}>
            {r.map((v, j) => <td key={j} className={`px-3 py-2 text-[12.5px] ${j ? 'text-right tabular-nums whitespace-nowrap' : 'text-left break-all'}`} style={{ color: j ? T.textBody : T.textPrimary }}>{v}</td>)}
          </tr>
        )) : <tr><td colSpan={head.length} className="px-3 py-6 text-center text-[12.5px]" style={{ color: T.textMuted }}>{empty}</td></tr>}
      </tbody>
    </table>
  );
}

function Panel({ title, sub, children }) {
  return (
    <div className="bg-white overflow-hidden" style={CARD}>
      <div className="px-4 pt-3 pb-2">
        <p className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>{title}</p>
        {sub ? <p className="text-[11.5px]" style={{ color: T.textMuted }}>{sub}</p> : null}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export default function HubTracker({ master = 7 }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/analytics/hub?days=${master}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (alive) setData(j); })
      .catch(() => { if (alive) setData({ error: 'Could not load hub analytics' }); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [master]);

  const t = data?.totals;
  const v = (x) => (loading && !t ? '…' : n(x));
  const period = rangeLabel(master);

  return (
    <div className="space-y-4" data-testid="hub-tracker-tab">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11.5px]" style={{ color: T.textMuted }}>
          casa-libre.com hub and blog (every country, ES/EN/PT), {period}. These visits are not counted in any country site&apos;s numbers on the other tabs.
          Not filtered by the header&apos;s country: the hub serves all countries.
        </p>
        {loading ? <span className="text-[11px] ml-auto" style={{ color: T.textMuted }}>Loading…</span> : null}
      </div>

      {data?.configured === false ? <Banner tone="warning">PostHog is not connected (POSTHOG_PERSONAL_API_KEY / POSTHOG_PROJECT_ID).</Banner> : null}
      {data?.error ? <Banner>{data.error}</Banner> : null}

      {data?.empty ? (
        <div className="bg-white px-6 py-12 text-center" style={CARD} data-testid="hub-empty">
          <p className="text-[15px] font-semibold" style={{ color: T.textPrimary }}>No hub data yet</p>
          <p className="text-[12px] mt-1" style={{ color: T.textMuted }}>
            No PostHog events from casa-libre.com in the {period}. Numbers appear here once the hub&apos;s tracking is live and people visit it.
          </p>
        </div>
      ) : null}

      {!data?.empty && data?.configured !== false ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Visitors" value={v(t?.visitors)} hint="Unique people on the hub (signed-in by account, others by IP)." />
            <Stat label="Page views" value={v(t?.pageviews)} hint="Every page opened on the hub, repeat views included." />
            <Stat label="Pages per visitor" value={t ? t.pagesPerVisitor.toLocaleString('en-US') : '…'} hint="Page views ÷ visitors: how deep people read." />
            <Stat label="Blog article views" value={v(t?.articleViews)} hint="Times a blog article was opened (blog_article_view)." />
            <Stat label="Country-site clicks" value={v(t?.countryClicks)} tone={T.success} hint={`Clicks on a country button to open that country's site · ${t ? n(t.countryClickers) : '—'} people.`} />
            <Stat label="Casa-Libre clicks" value={v(t?.clClicks)} tone={T.success} hint={`Clicks on Casa-Libre links inside blog articles · ${t ? n(t.clClickers) : '—'} people.`} />
            <Stat label="CTA clicks" value={v(t?.ctaClicks)} hint="Clicks on the hub's call-to-action buttons (hub_cta_click)." />
            <Stat label="Language switches" value={v(t?.langSwitches)} hint="Times a reader changed the blog language (ES / EN / PT)." />
          </div>

          <Panel title="Daily visitors" sub="Bars = unique visitors per day (Paraguay time). A green dot marks a day with at least one click to a country site.">
            <div className="px-4 pb-4">{data?.daily?.length ? <MiniBars daily={data.daily} /> : <p className="text-[12.5px] py-6 text-center" style={{ color: T.textMuted }}>No data yet.</p>}</div>
          </Panel>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Top pages" sub="The hub pages people opened most (hub_page, else the URL path): views and unique visitors.">
              <Table head={['Page', 'Views', 'Visitors']} rows={(data?.pages || []).map((r) => [r.page, n(r.views), n(r.visitors)])} />
            </Panel>
            <Panel title="Top blog articles" sub="Each article (slug) and the country blog it belongs to: times opened and unique readers.">
              <Table head={['Article', 'Country', 'Views', 'Readers']}
                rows={(data?.articles || []).map((r) => [
                  <span key="s">{r.slug}{r.category ? <span className="text-[11px] ml-1.5" style={{ color: T.textMuted }}>{r.category}</span> : null}</span>,
                  CC(r.country), n(r.views), n(r.visitors),
                ])} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Readers by blog country" sub="Which country's blog people read (the country of the article they opened).">
              <Table head={['Blog country', 'Readers', 'Article views']} rows={(data?.blogCountries || []).map((r) => [CC(r.country), n(r.visitors), n(r.views)])} />
            </Panel>
            <Panel title="Visitors by language" sub="The language the hub was shown in (hub_lang): Spanish, English or Portuguese.">
              <Table head={['Language', 'Visitors', 'Page views']} rows={(data?.langs || []).map((r) => [LANG_NAME[r.lang] || r.lang, n(r.visitors), n(r.views)])} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="What the hub sends to each country site"
              sub="Country-button clicks (hub_country_click) and Casa-Libre links clicked in blog articles (cl_click, country read from the link). People = unique people who clicked either.">
              <Table head={['Country site', 'Country clicks', 'Blog CL clicks', 'People']}
                rows={(data?.sends || []).map((r) => [CC(r.country), n(r.countryClicks), n(r.clClicks), n(r.people)])} />
            </Panel>
            <Panel title="Casa-Libre clicks from the blog, by link" sub="Which blog link was clicked (its utm_content tag), and by how many people.">
              <Table head={['utm_content', 'Clicks', 'People']} rows={(data?.clContent || []).map((r) => [r.content, n(r.clicks), n(r.people)])} />
            </Panel>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Panel title="Traffic sources" sub="Where visitors came from: AI engines (e.g. chatgpt.com) first, then utm_source when the link was tagged, else the referring site, else direct.">
              <Table head={['Source', 'Visitors', 'Page views']} rows={(data?.sources || []).map((r) => [r.source, n(r.visitors), n(r.views)])} />
            </Panel>
            <Panel title="Visitor countries" sub="Where visitors are physically, from their IP address (PostHog geoip). Not the same as the blog country they read.">
              <Table head={['Country', 'Visitors', 'Page views']} rows={(data?.geo || []).map((r) => [r.country, n(r.visitors), n(r.views)])} />
            </Panel>
          </div>

          <Panel title="Forms and calls" sub="The hub's contact form: started, sent and failed, and calls the visitor confirmed booking.">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 px-4 pb-4">
              <Stat label="Form starts" value={v(t?.formStarts)} hint={`Times someone began the form · ${t ? n(t.formStarters) : '—'} people.`} />
              <Stat label="Form submits" value={v(t?.formSubmits)} tone={T.success} hint={`Forms sent · ${t ? n(t.formSubmitters) : '—'} people.`} />
              <Stat label="Start → submit" value={t ? pct(t.formSubmitters, t.formStarters) : '—'} hint="Of the people who began the form, how many sent it." />
              <Stat label="Form errors" value={v(t?.formErrors)} tone={t?.formErrors ? T.danger : undefined} hint="Times sending failed (validation or server error)." />
              <Stat label="Calls confirmed" value={v(t?.callsConfirmed)} tone={T.success} hint="Visitors who confirmed a call with the team (call_confirmed)." />
            </div>
          </Panel>
        </>
      ) : null}
    </div>
  );
}
