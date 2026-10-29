'use client';
// WhatsApp campaigns — two tabs: New campaign (one batch: first N of an audience, skipping
// who an earlier batch had, or an earlier batch again) and Sent campaigns (every batch with
// delivered / read / replied / clicked). ?tab=new|sent · ?next=<id> prefills the next batch
// of that audience · ?from=<id> prefills "send that batch again".
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { T, PageHeader } from '@/components/automations/ui';
import NewCampaignForm from '@/components/campaigns/NewCampaignForm';
import SentCampaigns from '@/components/campaigns/SentCampaigns';

export default function CampaignsPage() {
  const router = useRouter();
  const [tab, setTab] = useState(null);
  const [prefill, setPrefill] = useState(undefined);   // undefined = still reading the link
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const next = sp.get('next');
    const from = sp.get('from');
    setTab(sp.get('tab') === 'new' || next || from ? 'new' : sp.get('tab') === 'sent' ? 'sent' : 'new');
    const id = next || from;
    if (!id) { setPrefill(sp.get('mode') === 'live' ? { mode: 'live' } : null); return; }
    fetch(`/api/campaigns/${id}`).then((r) => r.json()).then(({ campaign: c }) => {
      if (!c) { setPrefill(null); return; }
      const d = c.audience_def || {};
      setPrefill(next
        ? { mode: c.mode === 'test' ? 'test' : 'live', template: c.template, name: `${c.name} (next)`, source: d.source, segment: d.segment, size: d.size || 100, skip: true }
        : { mode: c.mode === 'test' ? 'test' : 'live', template: c.template, name: `${c.name} (again)`, source: 'batch', segment: c.id, batch_filter: 'not_read' });
    }).catch(() => setPrefill(null));
  }, []);
  const go = (t) => { setTab(t); router.replace(`/campaigns?tab=${t}`); };

  return (
    <div className="space-y-5">
      <PageHeader title="WhatsApp campaigns" sub="Send a template to a batch of people — the first 50, the next 100, or an earlier batch again — and compare how each batch did." />
      <div className="flex gap-1 border-b" style={{ borderColor: T.borderLight }} role="tablist">
        {[['new', 'New campaign'], ['sent', 'Sent campaigns']].map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => go(k)} data-testid={`tab-${k}`} className="px-4 py-2.5 text-[14px] -mb-px border-b-2"
            style={tab === k ? { borderColor: T.primary, color: T.textPrimary, fontWeight: 600 } : { borderColor: 'transparent', color: T.textSecondary }}>{l}</button>
        ))}
      </div>
      {tab === 'sent' ? <SentCampaigns /> : tab === 'new' && prefill !== undefined ? <NewCampaignForm key={JSON.stringify(prefill)} prefill={prefill} /> : <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>}
    </div>
  );
}
