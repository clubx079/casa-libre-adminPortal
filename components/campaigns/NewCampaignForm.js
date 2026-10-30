'use client';
// New WhatsApp campaign = one BATCH. The same steps as Relay → Campaigns → New campaign:
//   1 · Message   name + approved Utility / Marketing template
//   2 · Audience  users / leads / Relay contacts / pasted numbers / an earlier batch again;
//                 how many (first N), skipping who an earlier batch already had, live counts
//   3 · Variables each {{n}} (header + body) and the button, from a contact field or text
//   4 · Send      now / schedule / save as draft
// Live / Test at the top: Test runs on Relay's test key, and leads / users ride on the
// simulation numbers — nobody real is messaged. Live refuses leads (switched off for now).
// + a phone preview with a sample contact. POST /api/campaigns.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { T, CARD, Banner, btnPrimary, inputCls } from '@/components/automations/ui';
import { SOURCES, BATCH_FILTERS, TRACKED, previewText } from '@/lib/waCampaigns';

const AUDIENCES = {
  leads: { label: 'Leads (agents / agencies / developers)', segments: [['all', 'All leads'], ['agent', 'Agents'], ['agency', 'Agencies'], ['developer', 'Developers']], batches: true },
  users: { label: 'Casa Libre users with a WhatsApp', segments: [['all', 'Everyone with a phone'], ['verified', 'Verified WhatsApp only'], ['sellers', 'Sellers (have a listing)'], ['no_listing', 'No listing yet']], batches: true },
  relay: { label: 'Relay contacts', segments: [['all', 'All contacts'], ['opted_in', 'Opted-in contacts']], batches: true },
  batch: { label: 'An earlier batch (send again)', segments: [] },
  phones: { label: 'Phone numbers (paste)', segments: [] },
};
const SIZES = [[0, 'All'], [50, '50'], [100, '100'], [200, '200']];

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
          {button && <option value={TRACKED}>Tracked link: opens the sell wizard, counts clicks per batch</option>}
          {SOURCES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {button && value.source === TRACKED && (
          <p className="text-[11px]" style={{ color: T.textMuted }}>For templates whose button is <span className="font-mono">casa-libre.com.py/r/{'{{1}}'}</span>. The link becomes <span className="font-mono">/r/wa?sell=1&amp;b=&lt;this batch&gt;</span>: the tap is counted for this batch and the sell wizard opens.</p>
        )}
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

const fmt = (n) => Number(n || 0).toLocaleString('en-US');

// prefill (from "Send the next batch" / "Send again"): { mode, template, name, source, segment, size, skip, batch_filter }
export default function NewCampaignForm({ prefill = null }) {
  const router = useRouter();
  const [mode, setMode] = useState(prefill?.mode || 'test');
  const [tpls, setTpls] = useState(null);
  const [name, setName] = useState(prefill?.name || '');
  const [tplName, setTplName] = useState(prefill?.template || '');
  const [source, setSource] = useState(prefill?.source || 'leads');
  const [segment, setSegment] = useState(prefill?.segment || 'all');
  const [size, setSize] = useState(prefill?.size ?? 100);
  const [skip, setSkip] = useState(prefill?.skip ?? true);
  const [batchFilter, setBatchFilter] = useState(prefill?.batch_filter || 'all');
  const [batches, setBatches] = useState([]);
  const [phones, setPhones] = useState('');
  const [vars, setVars] = useState({ header: [], body: [], button: null });
  const [when, setWhen] = useState('now');
  const [sendAt, setSendAt] = useState('');
  const [counts, setCounts] = useState(null);
  const [countsErr, setCountsErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => { fetch('/api/campaigns?templates=1').then((r) => r.json()).then(setTpls).catch(() => setTpls({ templates: [] })); }, []);
  // the earlier batches of this mode, for "send again"
  useEffect(() => { fetch(`/api/campaigns?mode=${mode}`).then((r) => r.json()).then((j) => setBatches((j.campaigns || []).filter((c) => c.state !== 'draft'))).catch(() => setBatches([])); }, [mode]);
  const tpl = useMemo(() => (tpls?.templates || []).find((t) => t.name === tplName) || null, [tpls, tplName]);
  const nHead = Number(tpl?.variables?.header) || 0;
  const nBody = Number(tpl?.variables?.body) || 0;
  const nBtn = Array.isArray(tpl?.variables?.url_buttons) ? tpl.variables.url_buttons.length : 0;
  useEffect(() => { setVars({ header: Array.from({ length: nHead }, () => ({})), body: Array.from({ length: nBody }, (_, i) => (i === 0 ? { source: 'contact.first_name' } : {})), button: nBtn ? { source: TRACKED } : null }); }, [tplName, nHead, nBody, nBtn]);
  const keepSegment = useRef(!!prefill?.segment);   // the first run keeps a prefilled segment
  useEffect(() => {
    if (keepSegment.current) { keepSegment.current = false; return; }
    if (source === 'batch') setSegment(batches[0]?.id || '');
    else setSegment(AUDIENCES[source].segments[0]?.[0] || 'all');
  }, [source]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (source === 'batch' && !segment && batches[0]) setSegment(batches[0].id); }, [batches]); // eslint-disable-line react-hooks/exhaustive-deps

  // live counts for this batch (debounced)
  useEffect(() => {
    if ((source === 'phones' && !phones.trim()) || (source === 'batch' && !segment)) { setCounts(null); return undefined; }
    let alive = true;
    setCountsErr('');
    const t = setTimeout(() => {
      const qs = new URLSearchParams({ audience: '1', source, segment, mode, template: tplName, phones: source === 'phones' ? phones : '', size: String(size || 0), skip: skip ? '1' : '0', batch_filter: batchFilter, vars: JSON.stringify(vars) });
      fetch(`/api/campaigns?${qs}`).then((r) => r.json()).then((j) => { if (!alive) return; if (j.error) { setCountsErr(j.error); setCounts(null); } else setCounts(j); }).catch(() => alive && setCountsErr('failed'));
    }, 400);
    return () => { alive = false; clearTimeout(t); };
  }, [source, segment, phones, mode, tplName, vars, size, skip, batchFilter]);

  const receive = counts?.willReceive ?? 0;
  const blocked = mode === 'live' ? counts?.blocked : null;
  const batchable = !!AUDIENCES[source].batches;
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/campaigns', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, template: tplName, mode, when, send_at: when === 'schedule' && sendAt ? new Date(sendAt).toISOString() : null, audience: { source, segment, phones, size: batchable ? size : 0, skip: batchable && skip, batch_filter: batchFilter }, variables: vars }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.error) { setErr(j.error || 'Could not create the campaign.'); if (j.id) router.push(`/campaigns/${j.id}`); return; }
      router.push(`/campaigns/${j.id}`);
    } catch { setErr('Could not create the campaign.'); } finally { setBusy(false); }
  };

  const sample = previewText(tpl?.body || '', vars);
  const rg = counts?.range;
  return (
    <form onSubmit={submit} className="space-y-5" data-testid="new-campaign">
      <div className="flex flex-wrap items-center gap-2">
        {[['test', 'Test (simulated)'], ['live', 'Live']].map(([k, l]) => (
          <button key={k} type="button" onClick={() => setMode(k)} data-testid={`mode-${k}`} className="text-[13px] font-semibold px-3.5 py-1.5 rounded-full"
            style={{ background: mode === k ? T.primary : T.bgWhite, color: mode === k ? T.bgWhite : T.textBody, border: `1px solid ${mode === k ? T.primary : T.borderLight}` }}>{l}</button>
        ))}
        <span className="text-[11.5px]" style={{ color: T.textMuted }}>
          {mode === 'test' ? 'Relay test key: delivery is simulated and nothing reaches WhatsApp. Leads and users run on 10 simulation numbers.' : 'The real WhatsApp number — every message is real and paid.'}
        </span>
      </div>
      <div className="grid lg:grid-cols-[1fr_340px] gap-5 items-start">
        <div className="space-y-5">
          <Step n={1} title="Message">
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="c-name">Batch name</label><input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Agentes — lote 2" className={inputCls} /></div>
              <div>
                <label className="block text-[12.5px] font-semibold mb-1.5" htmlFor="c-tpl">Template</label>
                <select id="c-tpl" value={tplName} onChange={(e) => setTplName(e.target.value)} className={inputCls}>
                  <option value="">{tpls ? 'Choose a template…' : 'Loading…'}</option>
                  {(tpls?.templates || []).map((t) => <option key={t.name} value={t.name}>{t.name} · {t.language} · {t.category}</option>)}
                </select>
                <p className="text-[10.5px] mt-1" style={{ color: T.textMuted }}>Approved Utility and Marketing templates (Relay). Image / video headers: not available in Relay yet — text only.</p>
              </div>
            </div>
          </Step>

          <Step n={2} title="Audience" sub="Everyone who hasn't opted out receives it (Relay no longer needs an opt-in).">
            <div className="grid sm:grid-cols-2 gap-3">
              <select aria-label="Audience source" value={source} onChange={(e) => setSource(e.target.value)} className={inputCls}>
                {Object.entries(AUDIENCES).map(([k, a]) => <option key={k} value={k}>{a.label}</option>)}
              </select>
              {AUDIENCES[source].segments.length > 0 && (
                <select aria-label="Segment" value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls}>
                  {AUDIENCES[source].segments.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  {source === 'relay' && (counts?.tags || []).filter((t) => t !== 'cl-sim' || mode === 'test').map((t) => <option key={t} value={`tag:${t}`}>Tag: {t}</option>)}
                </select>
              )}
              {source === 'batch' && (
                <>
                  <select aria-label="Earlier batch" value={segment} onChange={(e) => setSegment(e.target.value)} className={inputCls} data-testid="from-batch">
                    {!batches.length && <option value="">No earlier batch in {mode === 'test' ? 'Test' : 'Live'} yet</option>}
                    {batches.map((b) => <option key={b.id} value={b.id}>{b.name} · {fmt(b.results?.recipients)} people{b.demo ? ' · demo' : ''}</option>)}
                  </select>
                  <select aria-label="Who of that batch" value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className={`${inputCls} sm:col-span-2`} data-testid="batch-filter">
                    {BATCH_FILTERS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                  </select>
                </>
              )}
            </div>
            {batchable && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <span className="text-[12.5px] font-semibold" style={{ color: T.textPrimary }}>How many</span>
                <div className="inline-flex rounded-full p-0.5" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
                  {SIZES.map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setSize(v)} className="px-3 py-1 rounded-full text-[12.5px]" style={size === v ? { background: '#fff', fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,.08)' } : { color: T.textSecondary }}>{l}</button>
                  ))}
                </div>
                <input type="number" min={1} aria-label="Batch size" value={size || ''} onChange={(e) => setSize(Math.max(0, Math.floor(Number(e.target.value) || 0)))} placeholder="All" className="w-[90px] px-3 py-1.5 rounded-full border text-[13px]" style={{ borderColor: T.borderLight }} data-testid="batch-size" />
                <label className="flex items-center gap-2 text-[12.5px]" style={{ color: T.textBody }}>
                  <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} data-testid="batch-skip" />
                  Skip people already in an earlier {mode === 'test' ? 'test ' : ''}batch
                </label>
              </div>
            )}
            {source === 'phones' && <textarea value={phones} onChange={(e) => setPhones(e.target.value)} rows={4} placeholder={'+595 981 123 456\n+595 971 000 000'} className={`${inputCls} mt-3 font-mono`} />}
            {batchable && rg && (
              <p className="text-[12.5px] mt-3" style={{ color: T.textBody }} data-testid="batch-range">
                {rg.to ? <>This batch: <b>#{fmt(rg.from)}–{fmt(rg.to)}</b> of {fmt(rg.of)}</> : <>Nobody left in this audience</>}
                {skip && rg.already ? <> · {fmt(rg.already)} already had an earlier batch</> : null}
                {` · ${fmt(rg.left)} left after this one`}
              </p>
            )}
            {mode === 'test' && counts?.simulated > 0 && <div className="mt-3"><Banner tone="warning"><b>Simulated.</b> The {fmt(counts.simulated)} people of this batch run on the 10 simulation numbers (+595 999 000 001…010). Their real numbers are never sent to Relay.</Banner></div>}
            {blocked && <div className="mt-3"><Banner>{blocked}</Banner></div>}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mt-4" data-testid="audience-counts">
              {[['Will receive', counts?.willReceive], ['In this batch', counts?.total], ['Not opted in (still receive)', counts?.noOptIn], ['Opted out', counts?.optedOut], ['Missing a value', counts?.missingValue]].map(([l, v], i) => (
                <div key={l} className="p-3" style={{ ...CARD, background: i === 0 ? T.successSurface : T.bgSurface }}>
                  <div className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted }}>{l}</div>
                  <div className="text-xl font-bold mt-0.5" style={{ color: T.textPrimary }}>{v == null ? '—' : fmt(v)}</div>
                </div>
              ))}
            </div>
            {counts?.usMarketing ? <p className="text-[11px] mt-2" style={{ color: T.textMuted }}>{counts.usMarketing} US number{counts.usMarketing === 1 ? '' : 's'} left out (Meta doesn&apos;t allow marketing templates to +1).</p> : null}
            {countsErr ? <p className="text-xs mt-2" style={{ color: T.danger }}>Could not count the audience: {countsErr}</p> : null}
            {counts?.invalid ? <p className="text-[11px] mt-2" style={{ color: T.textMuted }}>{counts.invalid} number{counts.invalid === 1 ? '' : 's'} left out (not a valid phone).</p> : null}
          </Step>

          <Step n={3} title="Variables" sub="Fill each template variable from a contact field or fixed text. Contacts missing a value are skipped.">
            {!tpl ? <p className="text-xs" style={{ color: T.textMuted }}>Choose a template first.</p> : (
              <div className="space-y-4">
                {Array.from({ length: nHead }, (_, i) => (
                  <VarPicker key={`h${i}`} label={`Header {{${i + 1}}}`} value={vars.header[i]} onChange={(v) => setVars((s) => ({ ...s, header: s.header.map((x, k) => (k === i ? v : x)) }))} />
                ))}
                {Array.from({ length: nBody }, (_, i) => (
                  <VarPicker key={i} label={`Body {{${i + 1}}}`} value={vars.body[i]} onChange={(v) => setVars((s) => ({ ...s, body: s.body.map((x, k) => (k === i ? v : x)) }))} />
                ))}
                {nBtn > 0 && <VarPicker label="Button 1 URL" button value={vars.button || {}} onChange={(v) => setVars((s) => ({ ...s, button: v }))} />}
                {nHead + nBody + nBtn === 0 && <p className="text-xs" style={{ color: T.textMuted }}>This template has no variables.</p>}
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
            <p className="text-[11.5px] mb-3" style={{ color: T.textMuted }}>Relay throttles to the number&apos;s messaging limit and pauses automatically if the quality rating drops.</p>
            {err ? <div className="mb-3"><Banner>{err}</Banner></div> : null}
            <button type="submit" data-testid="send-batch" disabled={busy || !!blocked || !tpl || !name.trim() || (when !== 'draft' && !receive)} className={btnPrimary}>
              {busy ? 'Working…' : when === 'draft' ? 'Save draft' : `${when === 'schedule' ? 'Schedule' : mode === 'test' ? 'Simulate' : 'Send'} to ${fmt(receive)} ${receive === 1 ? 'person' : 'people'}`}
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
            {(counts?.sample || []).length > 0 && (
              <div className="mt-3">
                <p className="text-[11px] font-semibold mb-1" style={{ color: T.textSecondary }}>First people in this batch</p>
                {counts.sample.map((s) => <p key={`${s.phone}${s.name}`} className="text-[11.5px] truncate" style={{ color: T.textBody }}>{s.name || '—'} <span className="font-mono" style={{ color: T.textMuted }}>{s.sim ? `sim ${s.phone.slice(-3)}` : s.phone}</span></p>)}
              </div>
            )}
          </div>
        </aside>
      </div>
    </form>
  );
}
