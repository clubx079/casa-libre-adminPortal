'use client';
// Templates → WhatsApp: the real WhatsApp templates in Relay (created and approved by
// Meta there), with their category, status, text and which automation uses each one.
// Preview = the message as it lands on the phone, like Relay's (header media, text, footer,
// button; Spanish | English). Read-only. Data: /api/whatsapp/templates.
import { useEffect, useMemo, useState } from 'react';
import { TemplatePreviewModal } from '@/components/campaigns/TemplatePreview';
import { templateLook } from '@/lib/waTemplateLook';
import { newestFirst } from '@/lib/waTemplateOrder';
import { MessageCircle } from 'lucide-react';
import { T, CARD, Pill, Banner, btnSecondary } from '@/components/automations/ui';

const STATUS = { APPROVED: ['success', 'Approved'], PENDING: ['warning', 'In review'], REJECTED: ['danger', 'Rejected'], PAUSED: ['danger', 'Paused'], DISABLED: ['danger', 'Disabled'], DRAFT: ['neutral', 'Draft'] };
const CATEGORY = { utility: ['info', 'Utility'], marketing: ['warning', 'Marketing'], authentication: ['ink', 'Authentication'] };

export default function WhatsAppTemplatesTab() {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = (fresh) => { setBusy(true); return fetch(`/api/whatsapp/templates${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' }).then((r) => r.json()).then(setD).catch((e) => setD({ error: String(e) })).finally(() => setBusy(false)); };
  useEffect(() => { load(false); }, []);
  const [open, setOpen] = useState(null);   // { template } in the preview
  const [order, setOrder] = useState('new');   // new = newest first (default) | az
  const rows = useMemo(() => (order === 'az' ? [...(d?.templates || [])].sort((a, b) => a.name.localeCompare(b.name)) : newestFirst(d?.templates || [])), [d, order]);
  const tpls = useMemo(() => new Map((d?.templates || []).map((t) => [t.name, t])), [d]);
  if (!d) return <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>;
  return (
    <div className="space-y-3" data-testid="whatsapp-templates">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[12.5px]" style={{ color: T.textSecondary }}>WhatsApp templates are created in Relay and approved by Meta (usually 30 min – 2 h). The same list serves every country.</p>
        <div className="flex gap-2">
          <select aria-label="Order" value={order} onChange={(e) => setOrder(e.target.value)} className="text-[12.5px] px-3 py-1.5 rounded-full border bg-white" style={{ borderColor: T.borderLight }} data-testid="wa-template-order">
            <option value="new">Newest first</option>
            <option value="az">A–Z</option>
          </select>
          <button onClick={() => load(true)} disabled={busy} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }}>{busy ? 'Refreshing…' : 'Refresh'}</button>
          {d.relayUrl && <a href={d.relayUrl} target="_blank" rel="noopener noreferrer" className={btnSecondary} style={{ borderColor: T.textPrimary, color: T.textPrimary }}>New template in Relay ↗</a>}
        </div>
      </div>
      {d.configured === false && <Banner tone="warning">RELAY_API_KEY is not set on the admin, so the WhatsApp templates can’t be listed.</Banner>}
      {d.error && <Banner>Relay: {d.error}</Banner>}
      <TemplatePreviewModal open={open} tpls={tpls} onClose={() => setOpen(null)} />
      <div className="overflow-hidden" style={CARD}>
        <div className="cl-scroll overflow-x-auto">
          <table className="w-full min-w-[900px]">
            <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
              <tr>{['Template', 'Category', 'Status', 'Text', 'Used by'].map((h) => <th key={h} className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider" style={{ color: T.textMuted }}>{h}</th>)}</tr>
            </thead>
            <tbody>
              {(d.templates || []).length === 0 ? (
                <tr><td colSpan={5} className="px-6 py-12 text-center"><MessageCircle className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} /><p className="text-sm" style={{ color: T.textSecondary }}>No WhatsApp templates yet</p></td></tr>
              ) : rows.map((t) => {
                const [st, sl] = STATUS[t.status] || ['neutral', t.status];
                const [ct, cl] = CATEGORY[t.category] || ['neutral', t.category];
                return (
                  <tr key={`${t.name}-${t.language}`} className="border-b align-top" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3">
                      <div className="text-[13px] font-mono font-medium" style={{ color: T.textPrimary }}>{t.name}</div>
                      <div className="text-[11px] mt-0.5" style={{ color: T.textMuted }}>{t.language} · {templateLook(t.name, t).format}{t.supported ? '' : ' · not used by automations'}</div>
                      <button type="button" onClick={() => setOpen({ template: t.name })} className="text-[12px] font-semibold mt-1.5 underline-offset-2 hover:underline" style={{ color: T.textPrimary }} data-testid="wa-template-preview">Preview</button>
                    </td>
                    <td className="px-4 py-3"><Pill tone={ct}>{cl}</Pill></td>
                    <td className="px-4 py-3"><Pill tone={st}>{sl}</Pill></td>
                    <td className="px-4 py-3 text-[12px] max-w-[420px] whitespace-pre-line" style={{ color: T.textBody }}>{t.body || '—'}</td>
                    <td className="px-4 py-3 text-[12px]" style={{ color: T.textBody }}>{t.usedBy?.length ? t.usedBy.join(', ') : <span style={{ color: T.textMuted }}>—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
