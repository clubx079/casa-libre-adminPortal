'use client';
// WhatsApp campaigns — the list (like Relay → Campaigns). Each campaign: template,
// audience, state and its results at a glance. Live = the real number; Test = Relay's
// simulated traffic (nothing reaches WhatsApp). Data: /api/campaigns.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, CARD, PageHeader, Pill, Banner, btnPrimary, fmtDate } from '@/components/automations/ui';

const STATE = { draft: ['neutral', 'Draft'], sending: ['info', 'Sending'], sent: ['success', 'Sent'], scheduled: ['warning', 'Scheduled'], failed: ['danger', 'Failed'] };

export default function CampaignsPage() {
  const [mode, setMode] = useState('live');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    fetch(`/api/campaigns?mode=${mode}`).then((r) => r.json()).then((j) => { if (!alive) return; if (j.error) setErr(j.error); else setData(j); }).catch(() => alive && setErr('failed'));
    return () => { alive = false; };
  }, [mode]);
  const list = data?.campaigns || [];

  return (
    <div className="space-y-5">
      <PageHeader
        title="WhatsApp campaigns"
        sub="Send an approved template to opted-in contacts, now or on a schedule — and see who received, read, clicked and replied."
        action={<Link href={`/campaigns/new?mode=${mode}`} className={btnPrimary}>New campaign</Link>}
      />
      <div className="flex items-center gap-2">
        {[['live', 'Live'], ['test', 'Test (simulated)']].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className="text-[13px] font-semibold px-3.5 py-1.5 rounded-full"
            style={{ background: mode === k ? T.primary : T.bgWhite, color: mode === k ? T.bgWhite : T.textBody, border: `1px solid ${mode === k ? T.primary : T.borderLight}` }}>{l}</button>
        ))}
      </div>
      {mode === 'test' && <Banner tone="warning">Test mode uses Relay&apos;s test key: delivery is simulated (sent → delivered → read) and <b>nothing reaches WhatsApp</b>.</Banner>}
      {err ? <Banner>Could not load: {err}</Banner> : null}

      <div className="bg-white overflow-hidden" style={CARD}>
        {!data && !err ? <p className="text-xs p-5" style={{ color: T.textMuted }}>Loading…</p> : list.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold" style={{ color: T.textPrimary }}>No campaigns yet</p>
            <p className="text-xs mt-1" style={{ color: T.textMuted }}>Pick an approved template and an audience of opted-in contacts, then send.</p>
            <Link href={`/campaigns/new?mode=${mode}`} className={`${btnPrimary} mt-4`}>New campaign</Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr style={{ color: T.textMuted }}>
                  {['Campaign', 'Template', 'Audience', 'Will receive', 'State', 'Created'].map((h, i) => <th key={h} className={`px-4 py-2.5 font-semibold ${i >= 3 && i <= 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const [tone, label] = STATE[c.state] || ['neutral', c.state];
                  return (
                    <tr key={c.id} className="border-t hover:bg-black/[.02]" style={{ borderColor: T.borderLight }}>
                      <td className="px-4 py-3"><Link href={`/campaigns/${c.id}`} className="font-semibold underline-offset-2 hover:underline" style={{ color: T.textPrimary }}>{c.name}</Link></td>
                      <td className="px-4 py-3 font-mono" style={{ color: T.textBody }}>{c.template} <span style={{ color: T.textMuted }}>· {c.category}</span></td>
                      <td className="px-4 py-3" style={{ color: T.textBody }}>{c.audience_def?.source}{c.audience_def?.segment && c.audience_def.segment !== 'all' ? ` · ${c.audience_def.segment}` : ''} <span style={{ color: T.textMuted }}>({c.counts?.total ?? 0})</span></td>
                      <td className="px-4 py-3 text-right font-semibold" style={{ color: T.textPrimary }}>{c.relay_audience?.eligible ?? c.counts?.willReceive ?? 0}</td>
                      <td className="px-4 py-3"><Pill tone={tone}>{label}</Pill>{c.send_at && c.state === 'scheduled' ? <span className="ml-2" style={{ color: T.textMuted }}>{fmtDate(c.send_at, true)}</span> : null}</td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: T.textSecondary }}>{fmtDate(c.created_at, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
