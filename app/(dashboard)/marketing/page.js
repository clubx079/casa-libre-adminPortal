'use client';
// Marketing — Google Ads, Search Console and GA4 for the active country. Step 1 (this
// page today): connect Google once and check each API works. The spend / sign-up /
// contact reports are added once the connection is live. lib/googleApi.js.
import { useEffect, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, btnPrimary } from '@/components/automations/ui';

const ITEMS = [
  ['clientId', 'GOOGLE_ADS_CLIENT_ID', 'OAuth client ID (from Hamza)'],
  ['clientSecret', 'GOOGLE_ADS_CLIENT_SECRET', 'OAuth client secret (from Hamza)'],
  ['developerToken', 'GOOGLE_ADS_DEVELOPER_TOKEN', 'Google Ads developer token'],
  ['loginCustomerId', 'GOOGLE_ADS_LOGIN_CUSTOMER_ID', 'Manager account 926-282-9495'],
  ['customerId', 'GOOGLE_ADS_CUSTOMER_ID', 'Ad account 874-655-0784'],
  ['ga4PropertyId', 'GA4_PROPERTY_ID', 'GA4 property 556681900'],
  ['refreshToken', 'GOOGLE_ADS_REFRESH_TOKEN', 'Refresh token — from “Connect Google” below'],
];

export default function MarketingPage() {
  const [s, setS] = useState(null);
  const [test, setTest] = useState(null);
  const [testing, setTesting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    fetch('/api/google/status').then((r) => r.json()).then(setS).catch(() => setS({ error: 'Could not load' }));
    try { if (new URLSearchParams(window.location.search).get('google') === 'missing_client') setNote('Add GOOGLE_ADS_CLIENT_ID and GOOGLE_ADS_CLIENT_SECRET to the admin settings first.'); } catch {}
  }, []);

  const runTest = async () => {
    setTesting(true); setTest(null);
    try { setTest((await (await fetch('/api/google/status?test=1')).json()).test); } catch (e) { setTest({ error: String(e) }); }
    setTesting(false);
  };

  if (!s) return <div className="text-[13px]" style={{ color: T.textMuted }}>Loading…</div>;
  const setup = s.setup || {};
  const canConnect = setup.clientId && setup.clientSecret;
  const Row = ({ ok, children }) => <div className="flex items-center gap-2 text-[13px]" style={{ color: T.textBody }}><span className="w-5 text-center font-bold" style={{ color: ok ? T.success : T.danger }}>{ok ? '✓' : '✗'}</span>{children}</div>;

  return (
    <div className="space-y-6" data-testid="marketing-page">
      <PageHeader title="Marketing" sub={`Google Ads, Search Console and Google Analytics — ${String(s.country || '').toUpperCase()}`} />
      {note && <Banner tone="warning">{note}</Banner>}

      <div className="rounded-[14px] p-5 space-y-4" style={CARD}>
        <div className="flex items-center gap-2">
          <span className="text-[15px] font-bold" style={{ color: T.textPrimary }}>Google connection</span>
          <Pill tone={setup.refreshToken ? 'success' : 'warning'}>{setup.refreshToken ? 'Connected' : 'Not connected yet'}</Pill>
        </div>

        <div className="space-y-1.5">
          {ITEMS.map(([k, name, label]) => (
            <Row key={k} ok={!!setup[k]}><span className="font-mono text-[12px]">{name}</span><span style={{ color: T.textMuted }}>— {label}</span></Row>
          ))}
        </div>

        <div className="rounded-[12px] px-4 py-3" style={{ background: T.bgSurface }}>
          <div className="text-[12px] font-semibold mb-1" style={{ color: T.textPrimary }}>Redirect URL for the OAuth client (send it to Hamza)</div>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-[12.5px] break-all" data-testid="redirect-uri">{s.redirectUri}</code>
            <button onClick={() => { navigator.clipboard?.writeText(s.redirectUri); setCopied(true); setTimeout(() => setCopied(false), 1500); }} className="text-[12px] font-semibold underline">{copied ? 'Copied' : 'Copy'}</button>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {canConnect
            ? <a href="/api/google/oauth/start" className={btnPrimary} data-testid="connect-google">{setup.refreshToken ? 'Reconnect Google' : 'Connect Google'}</a>
            : <span className="text-[12.5px]" style={{ color: T.textSecondary }}>“Connect Google” appears once the OAuth client ID and secret are in the admin settings.</span>}
          {setup.refreshToken && <button onClick={runTest} disabled={testing} className={btnPrimary} style={{ background: T.bgWhite, color: T.textPrimary, border: `1px solid ${T.textPrimary}` }}>{testing ? 'Testing…' : 'Test connection'}</button>}
        </div>
        <p className="text-[12px] leading-snug" style={{ color: T.textMuted }}>
          Connect: sign in as <b>omar@airosofts.com</b>. Google returns a refresh token, shown once — save it as <span className="font-mono">GOOGLE_ADS_REFRESH_TOKEN</span> in the admin settings and redeploy. Read-only access: nothing in Google Ads is ever changed from here.
        </p>

        {test && (
          <div className="space-y-2 pt-2 border-t" style={{ borderColor: T.borderLight }} data-testid="google-test">
            {test.error ? <Banner>{test.error}</Banner> : (
              <>
                <Row ok={test.ads?.ok}>Google Ads {test.ads?.ok ? `— last 7 days: ${test.ads.last7days.clicks} clicks, ${test.ads.last7days.impressions} impressions, US$${test.ads.last7days.cost}` : `— ${test.ads?.error}`}</Row>
                <Row ok={test.gsc?.ok}>Search Console {test.gsc?.ok ? `— ${test.gsc.site}: ${test.gsc.topQueries.length ? test.gsc.topQueries.map((q) => `“${q.query}” (${q.clicks})`).join(', ') : 'no queries yet'}` : `— ${test.gsc?.error}`}</Row>
                <Row ok={test.ga4?.ok}>Google Analytics {test.ga4?.ok ? `— last 7 days: ${test.ga4.last7days.sessions} sessions, ${test.ga4.last7days.activeUsers} users` : `— ${test.ga4?.error}`}</Row>
              </>
            )}
          </div>
        )}
      </div>

      <div className="rounded-[14px] p-5 text-[13px]" style={{ ...CARD, color: T.textSecondary }}>
        Coming once Google is connected: spend, clicks and cost per click by campaign, keyword and search term; sign-ups and listing contacts with cost per sign-up / per contact; rent vs sale and by city; listings published; organic top queries and pages; paid vs organic vs direct.
      </div>
    </div>
  );
}
