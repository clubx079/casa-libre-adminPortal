'use client';
// Sent campaigns — every batch with its results at a glance: who it went to (audience +
// #from–to), template, live / test / demo, and delivered · read · replied · clicked as a share
// of the batch. Each row: open it, send the next batch of the same audience, or send it
// again (everyone / didn't read / …). Data: /api/campaigns.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, CARD, Pill, Banner, fmtDate } from '@/components/automations/ui';

const STATE = { draft: ['neutral', 'Draft'], sending: ['info', 'Sending'], sent: ['success', 'Sent'], scheduled: ['warning', 'Scheduled'], failed: ['danger', 'Failed'] };
const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// one result cell: the count, its share, a thin bar
function Rate({ n, of, rate, color }) {
  return (
    <td className="px-3 py-3 text-right align-top">
      <div className="font-semibold tabular-nums" style={{ color: T.textPrimary }}>{fmt(n)}</div>
      <div className="text-[10.5px] tabular-nums" style={{ color: T.textMuted }}>{rate == null ? '—' : `${rate}%`}{of != null ? ` of ${fmt(of)}` : ''}</div>
      <div className="h-1 mt-1 rounded-full ml-auto w-[64px]" style={{ background: T.bgSurface }}>
        <div className="h-1 rounded-full" style={{ width: `${Math.min(100, rate || 0)}%`, background: color }} />
      </div>
    </td>
  );
}

export default function SentCampaigns() {
  const [mode, setMode] = useState('all');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setData(null); setErr('');
    fetch(`/api/campaigns${mode === 'all' ? '' : `?mode=${mode}`}`).then((r) => r.json()).then((j) => { if (!alive) return; if (j.error) setErr(j.error); else setData(j); }).catch(() => alive && setErr('failed'));
    return () => { alive = false; };
  }, [mode]);
  const list = data?.campaigns || [];
  const pct = (n, of) => (of ? Math.round((n / of) * 1000) / 10 : null);

  return (
    <div className="space-y-4" data-testid="sent-campaigns">
      <div className="flex flex-wrap items-center gap-2">
        {[['all', 'All'], ['live', 'Live'], ['test', 'Test & demo']].map(([k, l]) => (
          <button key={k} onClick={() => setMode(k)} className="text-[13px] font-semibold px-3.5 py-1.5 rounded-full"
            style={{ background: mode === k ? T.primary : T.bgWhite, color: mode === k ? T.bgWhite : T.textBody, border: `1px solid ${mode === k ? T.primary : T.borderLight}` }}>{l}</button>
        ))}
        <span className="text-[11.5px]" style={{ color: T.textMuted }}>Delivered = of sent · Read, replied and clicked = of delivered. Read is a minimum (read receipts can be off).</span>
      </div>
      {err ? <Banner>Could not load: {err}</Banner> : null}
      <div className="bg-white overflow-hidden" style={CARD}>
        {!data && !err ? <p className="text-xs p-5" style={{ color: T.textMuted }}>Loading…</p> : list.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold" style={{ color: T.textPrimary }}>No batches yet</p>
            <p className="text-xs mt-1" style={{ color: T.textMuted }}>Create one in the New campaign tab.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1040px]">
              <thead>
                <tr style={{ color: T.textMuted }}>
                  {['Batch', 'Template', 'Sent', 'People', 'Delivered', 'Read', 'Replied', 'Clicked', ''].map((h, i) => <th key={h || i} className={`px-3 py-2.5 font-semibold ${i >= 3 && i <= 7 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((c) => {
                  const [tone, label] = STATE[c.state] || ['neutral', c.state];
                  const s = c.results || {};
                  return (
                    <tr key={c.id} className="border-t hover:bg-black/[.02]" style={{ borderColor: T.borderLight }} data-testid="batch-row">
                      <td className="px-3 py-3 align-top max-w-[300px]">
                        <Link href={`/campaigns/${c.id}`} className="font-semibold underline-offset-2 hover:underline" style={{ color: T.textPrimary }}>{c.name}</Link>
                        <div className="text-[11px] mt-0.5" style={{ color: T.textSecondary }}>{c.audience_label}</div>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <Pill tone={tone}>{label}</Pill>
                          {c.demo ? <Pill tone="warning">Demo data</Pill> : c.mode === 'test' ? <Pill tone="info">Test · simulated</Pill> : <Pill tone="ink">Live</Pill>}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top font-mono" style={{ color: T.textBody }}>{c.template}<div className="font-sans text-[10.5px]" style={{ color: T.textMuted }}>{c.category}</div></td>
                      <td className="px-3 py-3 align-top whitespace-nowrap" style={{ color: T.textSecondary }}>{fmtDate(c.sent_at || c.send_at || c.created_at, true)}</td>
                      <td className="px-3 py-3 text-right align-top">
                        <div className="font-semibold tabular-nums" style={{ color: T.textPrimary }}>{fmt(s.recipients)}</div>
                        <div className="text-[10.5px]" style={{ color: T.textMuted }}>{s.skipped ? `${fmt(s.skipped)} skipped` : ''}{s.failed ? `${s.skipped ? ' · ' : ''}${fmt(s.failed)} failed` : ''}</div>
                      </td>
                      <Rate n={s.delivered} of={s.sent} rate={s.deliveredRate} color={T.info} />
                      <Rate n={s.read} of={s.delivered} rate={s.readRate} color={T.success} />
                      <Rate n={s.replied} of={s.delivered} rate={s.replyRate} color="#7A5BA6" />
                      <Rate n={s.clicked} of={s.delivered} rate={s.clickRate ?? pct(s.clicked, s.delivered)} color="#B8741A" />
                      <td className="px-3 py-3 align-top text-right whitespace-nowrap">
                        {c.state !== 'draft' && <>
                          {c.audience_def?.source && !['batch', 'phones'].includes(c.audience_def.source) && <Link href={`/campaigns?tab=new&next=${c.id}`} className="block text-[11.5px] font-semibold underline-offset-2 hover:underline" style={{ color: T.textPrimary }}>Next batch</Link>}
                          <Link href={`/campaigns?tab=new&from=${c.id}`} className="block text-[11.5px] mt-1 underline-offset-2 hover:underline" style={{ color: T.textSecondary }}>Send again</Link>
                        </>}
                      </td>
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
