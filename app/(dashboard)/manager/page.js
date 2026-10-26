'use client';
// Admin Manager — every weekly AI report for the active country, newest first. A report is
// written every Monday 07:00 (Paraguay) by the cron (no manual run button). Click a report
// to read it and handle its draft emails. Data: /api/manager. lib/manager/*.
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T, CARD, PageHeader, Pill, Banner, fmtDate } from '@/components/automations/ui';
import MemoryPanel from '@/components/manager/MemoryPanel';

const STATUS ={ running: ['info', 'Writing…'], done: ['success', 'Ready'], failed: ['danger', 'Failed'] };

const range = (r) => (r.period_start ? `${fmtDate(r.period_start)} – ${fmtDate(r.period_end)}` : fmtDate(r.created_at));

export default function ManagerPage() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = useCallback(() => {
    fetch('/api/manager').then((r) => r.json()).then((j) => { if (j.error) setErr(j.error); else { setErr(''); setData(j); } }).catch(() => setErr('failed'));
  }, []);
  useEffect(() => { load(); }, [load]);
  // while one is being written, refresh the list every few seconds
  const busy = (data?.reports || []).some((r) => r.status === 'running');
  useEffect(() => {
    if (!busy) return undefined;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [busy, load]);

  const list = data?.reports || [];
  return (
    <div className="space-y-5">
      <PageHeader
        title="Admin Manager"
        sub="AI report every Monday, Wednesday and Friday 07:00, covering the days since the last one. Its personal emails are sent automatically."
      />
      {data?.configured === false && <Banner tone="warning">Set <span className="font-mono">ANTHROPIC_API_KEY</span> on the server to turn the Admin Manager on.</Banner>}
      {err === 'migration_pending' || data?.pending ? (
        <Banner tone="warning"><b>Not set up for this country yet.</b> Apply <span className="font-mono">migrations/007_admin_manager.sql</span> (admin repo) to this country&apos;s database in the AiroBase SQL editor, then reload.</Banner>
      ) : err ? <Banner>Could not load: {err}</Banner> : null}

      <div className="bg-white overflow-hidden" style={CARD}>
        {!data && !err ? <p className="text-xs p-5" style={{ color: T.textMuted }}>Loading…</p> : list.length === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm font-semibold" style={{ color: T.textPrimary }}>No reports yet</p>
            <p className="text-xs mt-1" style={{ color: T.textMuted }}>The first one is written at the next Monday, Wednesday or Friday 07:00.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[760px]">
              <thead>
                <tr style={{ color: T.textMuted }}>
                  {['Period', 'Headline', 'Emails to review', 'Status', 'Cost', 'Made'].map((h, i) => <th key={h} className={`px-4 py-2.5 font-semibold ${i === 2 || i === 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {list.map((r) => {
                  const [tone, label] = STATUS[r.status] || ['neutral', r.status];
                  return (
                    <tr key={r.id} onClick={() => router.push(`/manager/${r.id}`)} className="border-t hover:bg-black/[.02] cursor-pointer" style={{ borderColor: T.borderLight }}>
                      <td className="px-4 py-3 whitespace-nowrap"><Link href={`/manager/${r.id}`} className="font-semibold underline-offset-2 hover:underline" style={{ color: T.textPrimary }}>{range(r)}</Link></td>
                      <td className="px-4 py-3" style={{ color: T.textBody }}>{r.headline || (r.status === 'failed' ? <span style={{ color: T.danger }}>{String(r.error || '').slice(0, 120)}</span> : '—')}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {r.pending ? <Pill tone="warning">{r.pending} to review</Pill> : null}
                        {r.sent ? <span className="ml-2" style={{ color: T.textMuted }}>{r.sent} sent</span> : null}
                        {!r.pending && !r.sent ? <span style={{ color: T.textMuted }}>{r.status === 'done' ? '0' : '—'}</span> : null}
                      </td>
                      <td className="px-4 py-3"><Pill tone={tone}>{label}</Pill>{r.trigger === 'cron' ? <span className="ml-2" style={{ color: T.textMuted }}>weekly</span> : <span className="ml-2" style={{ color: T.textMuted }}>manual</span>}</td>
                      <td className="px-4 py-3 text-right" style={{ color: T.textSecondary }}>{r.cost_usd != null ? `US$${Number(r.cost_usd).toFixed(2)}` : '—'}</td>
                      <td className="px-4 py-3 whitespace-nowrap" style={{ color: T.textSecondary }}>{fmtDate(r.created_at, true)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MemoryPanel compact />
    </div>
  );
}
