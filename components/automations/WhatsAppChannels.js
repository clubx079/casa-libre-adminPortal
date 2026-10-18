'use client';
// Automations → each card's "Send by" row: how that automation sends — Email, WhatsApp or
// both — and which approved WhatsApp template (Relay) stands in for each of its emails.
// Data: /api/automations/channels (migration 017). The website does the sending
// (buyer lib/automations/whatsappSend.js); WhatsApp goes only to people with a number
// and consent, everyone else still gets the email.
import { useEffect, useState } from 'react';
import { T, Pill, Banner, btnPrimary } from '@/components/automations/ui';

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

function Row({ a, relay, whatsappHere, note, onSaved }) {
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
    <div className="px-5 md:px-6 py-3.5 border-b" style={{ borderColor: T.borderLight }} data-testid={`channel-${a.id}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[10px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>Send by</span>
        <Segmented value={channel} onChange={pickChannel} disabled={!whatsappHere || busy} />
        {!whatsappHere && <span className="text-[11.5px]" style={{ color: T.textMuted }}>{note}</span>}
        {(w.sent || w.delivered || w.read || w.failed) ? (
          <span className="text-[11.5px]" style={{ color: T.textSecondary }}>WhatsApp so far: {w.sent + w.delivered + w.read} sent · {w.delivered + w.read} delivered · {w.read} read{w.failed ? ` · ${w.failed} failed` : ''}</span>
        ) : null}
        {dirty && <button onClick={save} disabled={busy} className={`${btnPrimary} ml-auto`}>{busy ? 'Saving…' : 'Save channel'}</button>}
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

// One request for all the cards on the page (each card asks for its own automation).
let shared = null;
const listeners = new Set();
function loadShared(force = false) {
  if (!shared || force) {
    shared = fetch('/api/automations/channels', { cache: 'no-store' }).then((r) => r.json()).catch((e) => ({ error: String(e) }));
    shared.then((d) => listeners.forEach((fn) => fn(d)));
  }
  return shared;
}

// The "Send by" row of one automation card. Renders nothing for an automation the
// country's DB doesn't have yet.
export function ChannelControl({ id }) {
  const [d, setD] = useState(null);
  useEffect(() => {
    let live = true;
    const fn = (x) => { if (live) setD(x); };
    listeners.add(fn);
    loadShared().then(fn);
    return () => { live = false; listeners.delete(fn); };
  }, []);
  if (!d) return null;
  if (d.error && !d.automations) return null;
  if (!d.setUp) {
    return <div className="px-5 md:px-6 py-3 border-b text-[12px]" style={{ borderColor: T.borderLight, color: T.textMuted }}><span className="text-[10px] font-mono uppercase tracking-label mr-2">Send by</span>Email — WhatsApp needs migration 017 on this country’s database.</div>;
  }
  const a = d.automations.find((x) => x.id === id);
  if (!a) return null;
  const whatsappHere = d.whatsappHere && d.relayConfigured;
  const note = !d.whatsappHere ? 'WhatsApp templates link to the Paraguay site — email only here for now.' : !d.relayConfigured ? 'RELAY_API_KEY is not set on the admin.' : '';
  return (
    <>
      {d.relayError && <div className="px-5 md:px-6 pt-3"><Banner>Relay: {d.relayError}</Banner></div>}
      <Row key={`${a.id}-${a.channel}-${JSON.stringify(a.wa_templates)}`} a={a} relay={d.relayTemplates} whatsappHere={whatsappHere} note={note} onSaved={() => loadShared(true)} />
    </>
  );
}
