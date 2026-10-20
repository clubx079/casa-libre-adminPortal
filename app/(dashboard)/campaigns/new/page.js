'use client';
// New WhatsApp campaign — the same 4 steps as Relay → Campaigns → New campaign:
//   1 · Message   name + approved Utility / Marketing template
//   2 · Audience  Casa Libre users / Relay contacts / phone numbers (leads: preview only),
//                 with live counts — only opted-in contacts receive it
//   3 · Variables each {{n}} and the button from a contact field or fixed text
//   4 · Send      now / schedule / save as draft · Live or Test (simulated)
// + a phone preview with a sample contact. POST /api/campaigns.
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { T, CARD, PageHeader, Banner, btnPrimary, inputCls } from '@/components/automations/ui';
import { SOURCES, previewText } from '@/lib/waCampaigns';

const AUDIENCES = {
  users: { label: 'Casa Libre users with a WhatsApp', segments: [['all', 'Everyone with a phone'], ['verified', 'Verified WhatsApp only'], ['sellers', 'Sellers (have a listing)'], ['no_listing', 'No listing yet']] },
  relay: { label: 'Relay contacts', segments: [['opted_in', 'All opted-in contacts'], ['all', 'All contacts']] },
  phones: { label: 'Phone numbers (paste)', segments: [] },
  leads: { label: 'Leads (agents / agencies / developers) — preview only', segments: [['all', 'All leads'], ['agent', 'Agents'], ['agency', 'Agencies'], ['developer', 'Developers']] },
};

function Step({ n, title, sub, children }) {
  return (
    <section className="bg-white p-5" style={CARD}>
      <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>{n} · {title}</h2>
      {sub ? <p className="text-[11.5px] mt-0.5 mb-3" style={{ color: T.textMuted }}>{sub}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}

function VarPicker({ label, example, value = {}, onChange, button }) {
  return (
    <div className="grid sm:grid-cols-[150px_1fr] gap-2 items-start">
      <div className="pt-2">
        <p className="text-[12.5px] font-semibold" style={{ color: T.textPrimary }}>{label}</p>
        {example ? <p className="text-[10.5px]" style={{ color: T.textMuted }}>e.g. {example}</p> : null}
      </div>
      <div className="space-y-2">
        <select aria-label={`${label} source`} value={value.source || ''} onChange={(e) => onChange({ ...value, source: e.target.value })} className={inputCls}>
          <option value="">Choose…</option>
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {value.source === 'static' && (
          <input value={value.text || ''} onChange={(e) => onChange({ ...value, text: e.target.value })} placeholder={button ? 'the end of the link, e.g. 6b1f… or ?tab=…' : 'Same text for everyone'} className={inputCls} />
        )}
        {button && value.source === 'static' && (
          <label className="flex items-center gap-2 text-[11.5px]" style={{ color: T.textSecondary }}>
            <input type="checkbox" checked={value.track !== false} onChange={(e) => onChange({ ...value, track: e.target.checked })} />
            Count clicks (adds utm_source=whatsapp to the link)
          </label>
        )}
      </div>
    </div>
  );
}

export default function NewCampaignPage() {
  const router = useRouter();
  const [mode, setMode] = useState('live');
  useEffect(() => { try { const m = new URLSearchParams(window.location.search).get('mode'); if (m === 'test') setMode('test'); } catch {} }, []);
  const [tpls, setTpls] = useState(null);
  const [name, setName] = useState('');
  const [tplName, setTplName] = useState('');
  const [source, setSource] = useState('users');
  const [segment, setSegment] = useState('all');
  const [phones, setPhones] = useState('');
  const [vars, setVars] = useState({ body: [], button: null });
  const [when, setWhen] = useState('now');
  const [sendAt, setSendAt] = useState('');
  const [counts, setCounts] = useState(null);
  const [countsErr, setCountsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { fetch('/api/campaigns?templates=1').then((r) => r.json()).then(setTpls).catch(() => setTpls({ templates: [] })); }, []);
  const tpl = useMemo(() => (tpls?.templates || []).find((t) => t.name === tplName) || null, [tpls, tplName]);
  const nBody = Number(tpl?.variables?.body) || 0;
  const nBtn = Array.isArray(tpl?.variables?.url_buttons) ? tpl.variables.url_buttons.length : 0;
  useEffect(() => { setVars({ body: Array.from({ length: nBody }, (_, i) => (i === 0 ? { source: 'contact.first_name' } : {})), button: nBtn ? {} : null }); }, [tplName, nBody, nBtn]);
  useEffect(() => { const segs = AUDIENCES[source].segments; setSegment(segs[0]?.[0] || 'all'); }, [source]);

  // live audience counts (debounced)
  useEffect(() => {
    if (source === 'phones' && !phones.trim()) { setCounts(null); return undefined; }
    let alive = true;
    setCountsErr('');
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ audience: '1', source, segment, mode, template: tplName, phones: source === 'phones' ? phones : '', vars: JSON.stringify(vars) });
      fetch(`/api/campaigns?${qs}`).then((r) => r.json()).then((j) => { if (!alive) return; if (j.error) { setCountsErr(j.error); setCounts(null); } else setCounts(j); }).catch(() => alive && setCountsErr('failed'));
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [source, segment, phones, mode, tplName, vars]);

  const leads = source === 'leads';
  const receive = counts?.willReceive ?? 0;
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, template: tplName, mode, when, send_at: when === 'schedule' && sendAt ? new Date(sendAt).toISOString() : null, audience: { source, segment, phones }, variables: vars }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { setErr(j.error || 'Could not create the campaign.'); return; }
      router.push(`/campaigns/${j.id}`);
    } catch { setErr('Could not create the campaign.'); } finally { setBusy(false); }
  };

  const sample = previewText(tpl?.body || '', vars);
  return (
    <form onSubmit={submit} className="space-y-5">
      <PageHeader title="New campaign" sub={<><Link href="/campaigns" className="underline">WhatsApp campaigns</Link> · {mode === 'test' ? 'Test mode (simulated — nothing reaches WhatsApp)' : 'Live — the real number'}</>} />
      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5">
          <Step n={1} title="Message">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="c-name">Campaign name</label><input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Octubre — vendedores sin publicación" className={inputCls} /></div>
              <div>
                <label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="c-tpl">Template</label>
                <select id="c-tpl" value={tplName} onChange={(e) => setTplName(e.target.value)} className={inputCls}>
                  <option value="">{tpls ? 'Choose a template…' : 'Loading…'}</option>
                  {(tpls?.templates || []).map((t) => <option key={t.name} value={t.name}>{t.name} · {t.language} · {t.category}</option>)}
                </select>
                <p className="text-[10.5px] mt-1" style={{ color: T.textMuted }}>Approved Utility and Marketing templates (Relay).</p>
              </div>
            </div>
          </Step>

          <Step n={2} title="Audience" sub="Only opted-in contacts receive it. Opted-out and no-opt-in contacts are always skipped.">
            <div className="grid sm:grid-cols-2 gap-3">
              <select aria-label="Audience source" value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
                {Object.entries(AUDIENCES).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
              </select>
              {AUDIENCES[source].segments.length > 0 && (
                <select aria-label="Segment" value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
                  {AUDIENCES[source].segments.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  {source === 'relay' && (counts?.tags || []).map((t) => <option key={t} value={`tag:${t}`}>Tag: {t}</option>)}
                </select>
              )}
            </div>
            {source === 'phones' && <textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={4} placeholder={'+595 981 123 456\n+595 971 000 000'} className={`${inputCls} mt-3 font-mono`} />}
            {leads && <div className="mt-3"><Banner tone="warning"><b>Preview only.</b> The leads never opted in, so no campaign is sent to their numbers for now (live or test).</Banner></div>}
            <div className="grid grid-cols-2 sm:grid-cols-6 gap-3 mt-4" data-testid="audience-counts">
              {[['Will receive', counts?.willReceive], ['In audience', counts?.total], ['No opt-in', counts?.noOptIn], ['Opted out', counts?.optedOut], ['Missing a value', counts?.missingValue], ['US · marketing', counts?.usMarketing]].map(([l, v], i) => (
                <div key={l} className="p-3" style={{ ...CARD, background: i === 0 ? T.successSurface : T.bgSurface }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>{l}</div>
                  <div className="text-xl font-bold mt-0.5" style={{ color: T.textPrimary }}>{v == null ? '—' : v.toLocaleString('en-US')}</div>
                </div>
              ))}
            </div>
            {countsErr ? <p className="text-xs mt-2" style={{ color: T.danger }}>Could not count the audience: {countsErr}</p> : null}
            {counts?.invalid ? <p className="text-[11px] mt-2" style={{ color: T.textMuted }}>{counts.invalid} number{counts.invalid === 1 ? '' : 's'} left out (not a valid phone).</p> : null}
          </Step>

          <Step n={3} title="Variables" sub="Fill each template variable from a contact field or fixed text. Contacts missing a value are skipped.">
            {!tpl ? <p className="text-xs" style={{ color: T.textMuted }}>Choose a template first.</p> : (
              <div className="space-y-4">
                {Array.from({ length: nBody }, (_, i) => (
                  <VarPicker key={i} label={`Body {{${i + 1}}}`} value={vars.body[i]} onChange={(v) => setVars((s) => ({ ...s, body: s.body.map((x, k) => (k === i ? v : x)) }))} />
                ))}
                {nBtn > 0 && <VarPicker label="Button 1 URL" button value={vars.button || {}} onChange={(v) => setVars((s) => ({ ...s, button: v }))} />}
                {nBody === 0 && nBtn === 0 && <p className="text-xs" style={{ color: T.textMuted }}>This template has no variables.</p>}
              </div>
            )}
          </Step>

          <Step n={4} title="Send">
            <div className="flex flex-wrap gap-4 mb-3">
              {[['now', 'Send now'], ['schedule', 'Schedule'], ['draft', 'Save as draft']].map(([k, l]) => (
                <label key={k} className="flex items-center gap-2 text-[13px]" style={{ color: T.textBody }}><input type="radio" name="when" checked={when === k} onChange={() => setWhen(k)} />{l}</label>
              ))}
            </div>
            {when === 'schedule' && <input type="datetime-local" value={sendAt} onChange={(e) => setSendAt(e.target.value)} className={`${inputCls} max-w-[260px] mb-3`} />}
            <label className="flex items-start gap-2 text-[13px] mb-3" style={{ color: T.textBody }}>
              <input type="checkbox" className="mt-1" checked={mode === 'test'} onChange={(e) => setMode(e.target.checked ? 'test' : 'live')} />
              <span><b>Test mode (simulate, don&apos;t send)</b><br /><span className="text-[11.5px]" style={{ color: T.textMuted }}>Runs the full pipeline with simulated delivery on Relay&apos;s test key. Nothing reaches WhatsApp. Same rule as live: only opted-in contacts are included.</span></span>
            </label>
            <p className="text-[11.5px] mb-3" style={{ color: T.textMuted }}>Relay throttles to the number&apos;s messaging limit and pauses automatically if the quality rating drops.</p>
            {err ? <div className="mb-3"><Banner>{err}</Banner></div> : null}
            <button type="submit" disabled={busy || leads || !tpl || !name.trim() || (when !== 'draft' && !receive)} className={btnPrimary}>
              {busy ? 'Working…' : when === 'draft' ? 'Save draft' : when === 'schedule' ? `Schedule for ${receive} contact${receive === 1 ? '' : 's'}` : `Send to ${receive} contact${receive === 1 ? '' : 's'}`}
            </button>
          </Step>
        </div>

        {/* phone preview, like Relay's */}
        <aside className="lg:sticky lg:top-4">
          <div className="p-4" style={{ ...CARD, background: '#EFEAE2' }}>
            <p className="text-[11px] font-semibold mb-2" style={{ color: T.textSecondary }}>Preview · sample contact</p>
            <div className="rounded-[12px] bg-white p-3 shadow-sm">
              <p className="text-[11px] font-bold" style={{ color: '#0F6E4A' }}>Casa Libre</p>
              <p className="text-[13px] whitespace-pre-wrap mt-1" style={{ color: T.textPrimary }} data-testid="preview">{tpl ? sample : 'Choose a template to see the message.'}</p>
              {tpl && nBtn > 0 && <div className="mt-2 pt-2 border-t text-center text-[12.5px] font-semibold" style={{ borderColor: T.borderLight, color: '#0F6E4A' }}>↗ Open link</div>}
            </div>
          </div>
        </aside>
      </div>
    </form>
  );
}
