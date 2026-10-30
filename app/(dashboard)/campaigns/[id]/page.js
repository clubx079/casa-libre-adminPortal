'use client';
// One WhatsApp campaign (batch) — who it went to, its results: sent / delivered / read /
// replied / clicked / failed / skipped, and every recipient with their status. "Refresh
// results" reads each recipient's conversation in Relay (Relay's API has no campaign-results
// endpoint); the website's Relay webhook also keeps the statuses current once a message is
// matched. "Next batch" / "Send again" open the New campaign tab prefilled.
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { T, CARD, PageHeader, Pill, Banner, btnPrimary, btnSecondary, fmtDate } from '@/components/automations/ui';
import { useDialog } from '@/components/Dialog';

const STATE = { draft: ['neutral', 'Draft'], sending: ['info', 'Sending'], sent: ['success', 'Sent'], scheduled: ['warning', 'Scheduled'], failed: ['danger', 'Failed'] };
const SKIP = { no_opt_in: 'Skipped · no opt-in', opted_out: 'Skipped · opted out', us_marketing: 'Skipped · US number (marketing)', missing_value: 'Skipped · missing a value', not_sent: 'Not sent by Relay' };
const statusColor = (s) => (s === 'read' ? T.success : s === 'delivered' ? T.info : s === 'failed' ? T.danger : T.textMuted);

export default function CampaignPage({ params }) {
  const router = useRouter();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const { dialog, confirm } = useDialog();
  const load = useCallback((fresh = false) => fetch(`/api/campaigns/${params.id}${fresh ? '?fresh=1' : ''}`).then((r) => r.json()).then((j) => { if (j.error) setErr(j.error); else setData(j); }).catch(() => setErr('failed')), [params.id]);
  useEffect(() => { load(); }, [load]);

  const act = async (action) => {
    setBusy(action); setNote('');
    try {
      const r = await fetch(`/api/campaigns/${params.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) setNote(j.error || 'Something went wrong.');
      else if (action === 'refresh') setNote(`Checked ${j.checked} recipient${j.checked === 1 ? '' : 's'} in Relay · ${j.updated} updated.`);
      else if (action === 'send') setNote(j.ok ? 'Sent to Relay.' : `Relay refused it: ${j.error}`);
      await load(action === 'refresh');   // Refresh results also re-reads the clicks (PostHog) now
    } finally { setBusy(''); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Remove this batch?', message: 'It disappears from the admin with its results. Messages already sent stay sent.', confirmLabel: 'Remove', tone: 'danger' }))) return;
    setBusy('delete');
    const r = await fetch(`/api/campaigns/${params.id}`, { method: 'DELETE' });
    if (r.ok) router.push('/campaigns?tab=sent'); else { setBusy(''); setNote('Could not remove it.'); }
  };

  if (err) return <Banner>Could not load: {err}</Banner>;
  if (!data) return <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>;
  const { campaign: c, results: s, recipients, clicks } = data;
  const [tone, label] = STATE[c.state] || ['neutral', c.state];
  const pct = (v) => (v == null ? '' : `${v}%`);

  return (
    <div className="space-y-5">
      {dialog}
      <PageHeader
        title={c.name}
        sub={<><Link href="/campaigns?tab=sent" className="underline">Sent campaigns</Link> · {c.audience_label} · <span className="font-mono">{c.template}</span> · {c.category} · {c.demo ? 'Demo data' : c.mode === 'test' ? 'Test (simulated)' : 'Live'} · created {fmtDate(c.created_at, true)}{c.created_by ? ` by ${c.created_by}` : ''}</>}
        action={
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={tone}>{label}</Pill>
            {c.state === 'draft'
              ? <button onClick={() => act('send')} disabled={!!busy} className={btnPrimary}>{busy === 'send' ? 'Sending…' : `Send now to ${c.counts?.willReceive ?? 0}`}</button>
              : !c.demo && <button onClick={() => act('refresh')} disabled={!!busy} className={btnPrimary}>{busy === 'refresh' ? 'Reading Relay…' : 'Refresh results'}</button>}
            {c.state !== 'draft' && c.audience_def?.source && !['batch', 'phones'].includes(c.audience_def.source) && <Link href={`/campaigns?tab=new&next=${c.id}`} className={btnSecondary} style={{ borderColor: T.borderLight }} data-testid="next-batch">Next batch</Link>}
            {c.state !== 'draft' && <Link href={`/campaigns?tab=new&from=${c.id}`} className={btnSecondary} style={{ borderColor: T.borderLight }} data-testid="send-again">Send again</Link>}
            <button onClick={remove} disabled={!!busy || c.state === 'sending'} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.danger }}>Remove</button>
          </div>
        }
      />
      {c.demo && <Banner tone="warning">Demo batch: sample numbers and made-up results so the page can be seen filled. Nothing was sent.</Banner>}
      {c.mode === 'test' && !c.demo && <Banner tone="warning">Test campaign: delivery was simulated by Relay. Nothing reached WhatsApp.{c.counts?.simulated ? ` ${c.counts.simulated} people ran on the simulation numbers — their real numbers were never sent to Relay.` : ''}</Banner>}
      {c.state === 'failed' && <Banner>Relay refused the campaign: {c.fail_reason}</Banner>}
      {c.state === 'scheduled' && <Banner tone="warning">Scheduled for {fmtDate(c.send_at, true)} — results appear after it goes out.</Banner>}
      {note ? <div className="text-xs px-4 py-2.5 rounded-full" style={{ background: T.bgSurface, color: T.textBody }}>{note}</div> : null}

      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3" data-testid="campaign-results">
        {[
          ['Recipients', s.recipients, `${c.relay_audience?.eligible ?? c.counts?.willReceive ?? 0} eligible`],
          ['Sent', s.sent, s.waiting ? `${s.waiting} waiting` : ''],
          ['Delivered', s.delivered, pct(s.deliveredRate)],
          ['Read', s.read, s.readRate != null ? `read rate ${s.readRate}%` : ''],
          ['Replied', s.replied, s.replyRate != null ? `${s.replyRate}% of delivered` : ''],
          ['Clicked', s.clicked, clicks?.note ? 'PostHog n/a' : s.clickRate != null ? `${s.clickRate}% of delivered` : 'people who opened the link'],
          ['Failed', s.failed, ''],
          ['Skipped', s.skipped, 'opted out / missing value'],
        ].map(([k, v, sub]) => (
          <div key={k} className="p-3" style={{ ...CARD, background: T.bgSurface }}>
            <div className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>{k}</div>
            <div className="text-xl font-bold mt-0.5" style={{ color: T.textPrimary }}>{Number(v || 0).toLocaleString('en-US')}</div>
            {sub ? <div className="text-[10px] mt-0.5" style={{ color: T.textMuted }}>{sub}</div> : null}
          </div>
        ))}
      </div>
      <p className="text-[11px]" style={{ color: T.textMuted }}>
        Sent / delivered / read come from WhatsApp (Relay); read is a minimum (people with read receipts off never send one). WhatsApp never reports button taps: clicks = people who tapped this batch&apos;s tracked link <span className="font-mono">/r/wa?b={c.slug}</span> (counted by the link itself, even if the page never loads) or landed with utm_campaign {c.slug}.
        {c.refreshed_at ? ` Last read from Relay ${fmtDate(c.refreshed_at, true)}.` : ''}
      </p>

      <div className="bg-white overflow-hidden" style={CARD}>
        <div className="px-4 py-3 border-b text-sm font-bold" style={{ borderColor: T.borderLight, color: T.textPrimary }}>Recipients · {recipients.length}</div>
        <div className="overflow-x-auto max-h-[560px]">
          <table className="w-full text-xs min-w-[620px]">
            <thead className="sticky top-0 bg-white"><tr style={{ color: T.textMuted }}>{['Phone', 'Name', 'From', 'Status', 'Replied', 'Clicked'].map((h, i) => <th key={h} className={`px-4 py-2 font-semibold ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
            <tbody>
              {recipients.map((r) => (
                <tr key={r.id} className="border-t" style={{ borderColor: T.borderLight }}>
                  <td className="px-4 py-2 font-mono" style={{ color: T.textPrimary }}>{r.phone}{r.meta?.sim ? <span className="block font-sans text-[10px]" style={{ color: T.textMuted }}>simulation number</span> : null}</td>
                  <td className="px-4 py-2" style={{ color: T.textBody }}>{r.meta?.name || '—'}</td>
                  <td className="px-4 py-2" style={{ color: T.textMuted }}>{r.meta?.source || ''}</td>
                  <td className="px-4 py-2 text-right font-semibold capitalize" style={{ color: r.meta?.skipped ? T.textMuted : statusColor(r.status) }}>
                    {r.meta?.skipped ? SKIP[r.meta.skipped] || 'Skipped' : r.status === 'sending' ? 'Waiting' : r.status}
                    {r.meta?.error ? <span className="block text-[10px] font-normal normal-case" style={{ color: T.danger }}>{r.meta.error}</span> : null}
                  </td>
                  <td className="px-4 py-2 text-right" style={{ color: r.meta?.replied_at ? T.success : T.textMuted }}>{r.meta?.replied_at ? fmtDate(r.meta.replied_at, true) : '—'}</td>
                  <td className="px-4 py-2 text-right" style={{ color: r.meta?.clicked_at ? T.success : T.textMuted }}>{r.meta?.clicked_at ? fmtDate(r.meta.clicked_at, true) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
