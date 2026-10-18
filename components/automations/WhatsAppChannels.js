'use client';
// Automations → "WhatsApp & channels": how each automation sends — Email, WhatsApp or
// both — and which approved WhatsApp template (Relay) stands in for each of its emails.
// Data: /api/automations/channels (migration 017). The website does the sending
// (buyer lib/automations/whatsappSend.js); WhatsApp goes only to people with a number
// and consent, everyone else still gets the email.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { T, CARD, Pill, Banner, btnPrimary } from '@/components/automations/ui';

const CHANNELS = [['email', 'Email'], ['whatsapp', 'WhatsApp'], ['both', 'Both']];
const PRICE = { utility: 'about US$0.011 / message', marketing: 'about US$0.074 / message' };
const ERRORS = {
  pick_a_whatsapp_template: 'Pick a WhatsApp template for at least one email.',
  whatsapp_template_not_approved: 'That WhatsApp template is not approved by Meta yet.',
  whatsapp_not_for_country: 'WhatsApp templates link to the Paraguay site — available for Paraguay only for now.',
  migration_pending: 'This country’s database needs migration 017 first.',
};

function Segmented({ value, onChange, disabled }) {
  return (
    <div className="inline-flex rounded-full p-1" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
      {CHANNELS.map(([v, l]) => (
        <button key={v} type="button" disabled={disabled} onClick={() => onChange(v)} className="px-3 py-1 rounded-full text-[12px] font-semibold disabled:opacity-50"
          style={value === v ? { background: T.textPrimary, color: '#fff' } : { color: T.textSecondary }}>{l}</button>
      ))}
    </div>
  );
}

function Row({ a, relay, whatsappHere, onSaved }) {
  const [channel, setChannel] = useState(a.channel);
  const [wa, setWa] = useState(a.wa_templates || {});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const byName = new Map(relay.map((t) => [t.name, t]));
  const dirty = channel !== a.channel || JSON.stringify(wa) !== JSON.stringify(a.wa_templates || {});
  // A WhatsApp choice starts from the template made for that email.
  const pickChannel = (v) => {
    setChannel(v); setMsg(null);
    if (v !== 'email') setWa((cur) => { const next = { ...cur }; for (const s of a.slots) if (!next[s.templateId] && s.suggested && byName.has(s.suggested)) next[s.templateId] = s.suggested; return next; });
  };
  const save = async () => {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch('/api/automations/channels', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.id, channel, wa_templates: wa }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setMsg({ bad: true, text: (ERRORS[j.error] || j.error || 'Could not save') + (j.names ? ` (${j.names.join(', ')})` : '') }); return; }
      setMsg({ text: 'Saved.' }); onSaved?.();
    } finally { setBusy(false); }
  };
  const w = a.whatsapp || {};
  return (
    <div className="py-4 border-t first:border-t-0" style={{ borderColor: T.borderLight }} data-testid={`channel-${a.id}`}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="text-[13.5px] font-semibold" style={{ color: T.textPrimary }}>{a.label} {!a.enabled && <span className="ml-1"><Pill>off</Pill></span>}</div>
          {(w.sent || w.delivered || w.read || w.failed) ? (
            <div className="text-[11.5px] mt-0.5" style={{ color: T.textSecondary }}>WhatsApp so far: {w.sent + w.delivered + w.read} sent · {w.delivered + w.read} delivered · {w.read} read{w.failed ? ` · ${w.failed} failed` : ''}</div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <Segmented value={channel} onChange={pickChannel} disabled={!whatsappHere || busy} />
          {dirty && <button onClick={save} disabled={busy} className={btnPrimary}>{busy ? 'Saving…' : 'Save'}</button>}
        </div>
      </div>
      {channel !== 'email' && (
        <div className="mt-3 grid gap-2">
          {a.slots.map((s) => {
            const t = byName.get(wa[s.templateId]);
            return (
              <div key={s.templateId} className="flex items-center gap-3 flex-wrap text-[12.5px]">
                <span className="w-[210px] shrink-0" style={{ color: T.textBody }}>{s.what}<span className="block text-[11px] truncate" style={{ color: T.textMuted }}>{s.templateName}</span></span>
                <select value={wa[s.templateId] || ''} onChange={(e) => { setWa((m) => ({ ...m, [s.templateId]: e.target.value })); setMsg(null); }}
                  className="px-3 py-1.5 rounded-full text-[12.5px] font-medium outline-none cursor-pointer" style={{ border: `1px solid ${T.borderLight}`, background: '#fff', color: T.textBody }}>
                  <option value="">— email only for this one —</option>
                  {relay.map((r) => <option key={r.name} value={r.name} disabled={r.status !== 'APPROVED'}>{r.name} · {r.category}{r.status !== 'APPROVED' ? ` (${r.status.toLowerCase()})` : ''}{r.name === s.suggested ? ' · made for this email' : ''}</option>)}
                </select>
                {t && <Pill tone={t.category === 'marketing' ? 'warning' : 'info'}>{t.category}</Pill>}
                {t && <span className="text-[11px]" style={{ color: T.textMuted }}>{PRICE[t.category] || ''}{t.category === 'marketing' ? ' · only people who accepted WhatsApp updates' : ''}</span>}
              </div>
            );
          })}
          <p className="text-[11px]" style={{ color: T.textMuted }}>{channel === 'whatsapp' ? 'People without a WhatsApp number or consent still get the email.' : 'Everyone gets the email; people with a number and consent also get the WhatsApp.'}</p>
        </div>
      )}
      {msg && <div className="mt-2 text-[12px] font-medium" style={{ color: msg.bad ? T.danger : T.success }}>{msg.text}</div>}
    </div>
  );
}

export default function WhatsAppChannels() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const load = () => fetch('/api/automations/channels', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.error && !j.automations) setErr(j.error); else setD(j); }).catch((e) => setErr(String(e)));
  useEffect(() => { load(); }, []);
  if (err) return <Banner>WhatsApp channels: {err}</Banner>;
  if (!d) return null;
  return (
    <div className="p-5" style={CARD} data-testid="whatsapp-channels">
      <div className="flex items-start justify-between gap-3 flex-wrap mb-1">
        <div>
          <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>WhatsApp &amp; channels</div>
          <div className="text-[12.5px] mt-0.5" style={{ color: T.textSecondary }}>Send each automation by email, WhatsApp or both. WhatsApp uses the approved templates in Relay — <Link href="/email-templates?tab=whatsapp" className="underline">see them</Link>.</div>
        </div>
      </div>
      {!d.setUp && <Banner tone="warning">This country’s database needs migration 017 (website migrations/017_whatsapp_automations.sql) before automations can use WhatsApp.</Banner>}
      {d.setUp && !d.whatsappHere && <Banner tone="warning">WhatsApp templates link to the Paraguay site, so automations here send email only for now.</Banner>}
      {d.setUp && !d.relayConfigured && <Banner tone="warning">RELAY_API_KEY is not set on the admin, so the WhatsApp templates can’t be listed.</Banner>}
      {d.relayError && <Banner>Relay: {d.relayError}</Banner>}
      {d.setUp && d.automations.map((a) => <Row key={a.id} a={a} relay={d.relayTemplates} whatsappHere={d.whatsappHere && d.relayConfigured} onSaved={load} />)}
    </div>
  );
}
