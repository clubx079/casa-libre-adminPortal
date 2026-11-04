'use client';
// Admin Manager → "Open issues": one list per day (the daily run, every 24 h), newest first —
// click a date to open that day's issues (/manager/issues/<day>). Data: /api/issues/days.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { T, CARD, Pill, fmtDate } from '@/components/automations/ui';

const nice = (day) => { try { return new Date(`${day}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch { return day; } };

export default function OpenIssuesDays() {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { fetch('/api/issues/days', { cache: 'no-store' }).then((r) => r.json()).then((j) => (j.error ? setErr(j.error) : setData(j))).catch(() => setErr('failed')); }, []);
  const days = data?.days || [];
  const rows = data && !days.some((d) => d.day === data.today) ? [{ day: data.today, pending: true }, ...days] : days;
  return (
    <section className="bg-white overflow-hidden" style={CARD} data-testid="manager-open-issues">
      <div className="px-5 pt-4 pb-3 border-b" style={{ borderColor: T.borderLight }}>
        <h2 className="text-[16px] font-semibold" style={{ color: T.textPrimary }}>Open issues</h2>
        <p className="text-[12.5px] mt-0.5" style={{ color: T.textMuted }}>Checked every day: people waiting on us, by name, with the fix. Click a day to open its list.</p>
      </div>
      {err ? <p className="px-5 py-4 text-[13px]" style={{ color: T.danger }}>Could not load: {err}</p> : !data ? <p className="px-5 py-4 text-xs" style={{ color: T.textMuted }}>Loading…</p> : (
        <table className="w-full text-xs">
          <thead><tr style={{ color: T.textMuted }}>{['Day', 'Open', 'Urgent', 'Checked'].map((h, i) => <th key={h} className={`px-5 py-2 font-semibold ${i === 1 || i === 2 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.day} onClick={() => router.push(`/manager/issues/${d.day}`)} className="border-t hover:bg-black/[.02] cursor-pointer" style={{ borderColor: T.borderLight }} data-testid="issues-day">
                <td className="px-5 py-2.5 whitespace-nowrap"><Link href={`/manager/issues/${d.day}`} className="font-semibold underline-offset-2 hover:underline" style={{ color: T.textPrimary }}>{nice(d.day)}{d.day === data.today ? ' · today' : ''}</Link></td>
                <td className="px-5 py-2.5 text-right tabular-nums" style={{ color: T.textBody }}>{d.pending ? '—' : d.open}</td>
                <td className="px-5 py-2.5 text-right">{d.pending ? '' : d.urgent ? <Pill tone="danger">{d.urgent}</Pill> : <span style={{ color: T.textMuted }}>0</span>}</td>
                <td className="px-5 py-2.5 whitespace-nowrap" style={{ color: T.textSecondary }}>{d.pending ? 'Not checked yet — opens and checks now' : fmtDate(d.checkedAt, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
