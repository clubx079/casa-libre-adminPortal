'use client';
// Bots — the Grok bots that collect outside data for Claude (lib/grokBots.js). FRONT END ONLY for
// now: no bot is connected, nothing runs, and the settings are kept in this browser. Once a bot is
// wired up, every run lands in its activity log here (what it did, what it found, what it cost,
// what waits for approval) — the team's check on the bots.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { T, CARD, PageHeader, Pill, Banner, inputCls, btnPrimary, btnSecondary } from '@/components/automations/ui';
import { BOTS, PRODUCT, COMMON_FIELDS, botByKey, mergeBotSettings, validateBotSettings, scheduleLabel } from '@/lib/grokBots';

const STORE = 'cl_grok_bots_v1';
const SEL = 'cl_grok_bots_selected';
const readStore = () => { try { return JSON.parse(localStorage.getItem(STORE) || '{}') || {}; } catch { return {}; } };
const writeStore = (v) => { try { localStorage.setItem(STORE, JSON.stringify(v)); return true; } catch { return false; } };

function Toggle({ checked, onChange, label, id }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} id={id} onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
      style={{ background: checked ? T.primary : T.borderLight }}>
      <span className="inline-block h-5 w-5 rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${checked ? 22 : 2}px)` }} />
    </button>
  );
}

function Field({ f, value, onChange, error }) {
  const id = `f-${f.key}`;
  const label = <label htmlFor={id} className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>{f.label}</label>;
  const help = f.help ? <p className="text-[12px] mt-1" style={{ color: T.textSecondary }}>{f.help}</p> : null;
  const err = error ? <p className="text-[12px] mt-1" style={{ color: T.danger }}>{error}</p> : null;
  if (f.type === 'toggle') {
    return (
      <div className="flex items-start justify-between gap-4 py-1">
        <div>{label}{help}</div>
        <Toggle id={id} label={f.label} checked={!!value} onChange={onChange} />
      </div>
    );
  }
  let input;
  if (f.type === 'select') {
    input = <select id={id} className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>{f.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>;
  } else if (f.type === 'multi') {
    const set = new Set(value || []);
    input = (
      <div id={id} className="flex flex-wrap gap-2" role="group" aria-label={f.label}>
        {f.options.map((o) => {
          const on = set.has(o.value);
          return (
            <button key={o.value} type="button" aria-pressed={on}
              onClick={() => { const n = new Set(set); if (on) n.delete(o.value); else n.add(o.value); onChange(f.options.map((x) => x.value).filter((v) => n.has(v))); }}
              className="text-[12px] font-medium px-3 py-1.5 rounded-full border transition-colors"
              style={on ? { background: T.primary, color: '#fff', borderColor: T.primary } : { background: T.bgWhite, color: T.textBody, borderColor: T.borderLight }}>
              {o.label}
            </button>
          );
        })}
      </div>
    );
  } else if (f.type === 'lines') {
    input = <textarea id={id} rows={Math.min(8, Math.max(3, String(value || '').split('\n').length + 1))} className={`${inputCls} font-mono text-[12.5px] leading-relaxed`} value={value} onChange={(e) => onChange(e.target.value)} />;
  } else if (f.type === 'number') {
    input = <input id={id} type="number" min={f.min} max={f.max} className={`${inputCls} max-w-[180px]`} value={value} onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))} />;
  } else if (f.type === 'time') {
    input = <input id={id} type="time" className={`${inputCls} max-w-[180px]`} value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <div className="flex flex-col gap-1.5">{label}{input}{help}{err}</div>;
}

// Grok collects → Claude analyses → a person approves: the bot's chain, in order.
function Chain({ steps }) {
  return (
    <ol className="flex flex-col sm:flex-row gap-2 sm:gap-0 sm:items-stretch">
      {steps.map((s, i) => (
        <li key={s} className="flex sm:flex-1 items-stretch min-w-0">
          <div className="flex-1 rounded-[12px] px-3 py-2.5 text-[12.5px] leading-snug" style={{ background: i === 0 ? T.primary : T.bgSurface, color: i === 0 ? '#fff' : T.textBody, border: `1px solid ${i === 0 ? T.primary : T.borderLight}` }}>
            <span className="block text-[11px] font-semibold mb-0.5" style={{ color: i === 0 ? '#ffffffb3' : T.textMuted }}>Step {i + 1}</span>
            {s}
          </div>
          {i < steps.length - 1 ? <span aria-hidden className="hidden sm:flex items-center px-1.5" style={{ color: T.textMuted }}>›</span> : null}
        </li>
      ))}
    </ol>
  );
}

const RUN_STATUS = { sent: ['info', 'Working…'], done: ['success', 'Done'], failed: ['danger', 'Failed'], no_answer: ['warning', 'No answer'] };
const APPROVAL = { pending: ['warning', 'Waiting for approval'], approved: ['success', 'Approved'], rejected: ['neutral', 'Rejected'], none: [null, ''] };
const when = (iso) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return '—'; } };
const thisMonth = (iso) => { const d = new Date(iso); const n = new Date(); return d.getFullYear() === n.getFullYear() && d.getMonth() === n.getMonth(); };

function ItemList({ items }) {
  if (!items?.length) return <p className="text-[12.5px]" style={{ color: T.textMuted }}>No items in this run.</p>;
  const keys = [...new Set(items.slice(0, 50).flatMap((x) => Object.keys(x)))].slice(0, 8);
  const cell = (v) => {
    if (v == null || v === '') return '—';
    const t = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /^https?:\/\//.test(t) ? <a href={t} target="_blank" rel="noreferrer" className="underline decoration-black/20 hover:decoration-black break-all">{t.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</a> : t.slice(0, 220);
  };
  return (
    <div className="overflow-x-auto rounded-[10px]" style={{ border: `1px solid ${T.borderLight}` }}>
      <table className="w-full text-[12px]">
        <thead><tr style={{ background: T.bgSurface }}>{keys.map((k) => <th key={k} className="text-left font-semibold px-2.5 py-2 whitespace-nowrap" style={{ color: T.textSecondary }}>{k}</th>)}</tr></thead>
        <tbody>{items.slice(0, 200).map((it, i) => (
          <tr key={i} className="border-t align-top" style={{ borderColor: T.borderLight }}>{keys.map((k) => <td key={k} className="px-2.5 py-2" style={{ color: T.textBody }}>{cell(it[k])}</td>)}</tr>
        ))}</tbody>
      </table>
      {items.length > 200 ? <p className="text-[11.5px] px-2.5 py-2" style={{ color: T.textMuted }}>Showing 200 of {items.length}.</p> : null}
    </div>
  );
}

function Activity({ bot, info, onRefresh, onRun, busy }) {
  const runs = info?.runs || [];
  const [open, setOpen] = useState(null);
  const decide = async (id, approval) => {
    await fetch(`/api/bots/runs/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approval }) }).catch(() => {});
    onRefresh();
  };
  const month = runs.filter((r) => thisMonth(r.startedAt) && r.trigger !== 'test');
  const tiles = [['Runs this month', month.length], ['Items found', month.reduce((s, r) => s + (r.itemCount || 0), 0)], ['Waiting for approval', runs.filter((r) => r.approval === 'pending').length]];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={btnPrimary} disabled={!info?.connected || busy} onClick={() => onRun(false)}>{busy ? 'Sending…' : 'Run now'}</button>
        <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }} onClick={onRefresh}>Refresh</button>
        {!info?.connected ? <span className="text-[12.5px]" style={{ color: T.textSecondary }}>Connect the bot in the Connection tab first.</span> : null}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiles.map(([k, v]) => (
          <div key={k} className="rounded-[12px] px-3.5 py-3" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
            <div className="text-[12px]" style={{ color: T.textSecondary }}>{k}</div>
            <div className="text-[20px] font-bold mt-0.5 tabular-nums" style={{ color: T.textPrimary }}>{v}</div>
          </div>
        ))}
      </div>
      {!runs.length ? (
        <div className="rounded-[12px] px-4 py-10 text-center" style={{ border: `1px solid ${T.borderLight}`, color: T.textSecondary }}>
          <div className="font-semibold text-[13px]" style={{ color: T.textPrimary }}>No runs yet</div>
          <div className="mt-1 max-w-md mx-auto text-[12.5px]">{info?.connected ? 'Press Run now to send the first job. The results appear here when the bot reports back.' : `Connect ${bot.name.toLowerCase()} in the Connection tab, then press Test connection.`}</div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {runs.map((r) => {
            const [tone, label] = RUN_STATUS[r.status] || RUN_STATUS.sent;
            const [atone, alabel] = APPROVAL[r.approval] || APPROVAL.none;
            const isOpen = open === r.id;
            return (
              <div key={r.id} className="rounded-[12px]" style={{ border: `1px solid ${T.borderLight}` }}>
                <button type="button" onClick={() => setOpen(isOpen ? null : r.id)} className="w-full text-left px-3.5 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12.5px]">
                  <span className="font-semibold tabular-nums" style={{ color: T.textPrimary }}>{when(r.startedAt)}</span>
                  <Pill tone={tone}>{label}</Pill>
                  <span style={{ color: T.textSecondary }}>{r.trigger === 'test' ? 'Connection test' : 'Job'}{r.by ? ` · ${r.by}` : ''}</span>
                  <span className="tabular-nums" style={{ color: T.textBody }}>{r.itemCount} found</span>
                  {alabel ? <Pill tone={atone}>{alabel}</Pill> : null}
                  <span className="ml-auto" style={{ color: T.textMuted }}>{isOpen ? 'Hide' : 'Details'}</span>
                </button>
                {isOpen ? (
                  <div className="px-3.5 pb-3.5 flex flex-col gap-3" style={{ borderTop: `1px solid ${T.borderLight}` }}>
                    <div className="pt-3 text-[12.5px]" style={{ color: T.textBody }}>
                      <b style={{ color: T.textPrimary }}>Summary: </b>{r.summary || (r.status === 'sent' ? 'The bot is working on it.' : r.status === 'no_answer' ? 'The bot never reported back. Check its chat in Grok.' : '—')}
                      {r.error ? <div className="mt-1" style={{ color: T.danger }}>{r.error}</div> : null}
                    </div>
                    <ItemList items={r.items} />
                    {r.approval === 'pending' ? (
                      <div className="flex gap-2">
                        <button type="button" className={btnPrimary} onClick={() => decide(r.id, 'approved')}>Approve results</button>
                        <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }} onClick={() => decide(r.id, 'rejected')}>Reject</button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Connection({ bot, info, onRefresh, onRun, busy }) {
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [saving, setSaving] = useState(false);
  const c = info?.connection;
  const save = async () => {
    setSaving(true); setMsg('');
    try {
      const j = await fetch(`/api/bots/${bot.key}/connection`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, key }) }).then((r) => r.json());
      if (j.error) setMsg(j.error); else { setUrl(''); setKey(''); setMsg('Connected. Now press Test connection.'); onRefresh(); }
    } catch { setMsg('Could not save. Check your connection and try again.'); }
    setSaving(false);
  };
  const disconnect = async () => {
    if (!window.confirm(`Disconnect ${bot.name}? The admin will stop sending it jobs.`)) return;
    await fetch(`/api/bots/${bot.key}/connection`, { method: 'DELETE' }).catch(() => {});
    onRefresh();
  };
  const testState = !c ? null : c.lastTestOk === true ? ['success', `Test passed${c.lastTestAt ? ` · ${when(c.lastTestAt)}` : ''}`] : c.lastTestOk === false ? ['danger', 'Test failed — see Activity'] : c.lastTestAt ? ['info', 'Test sent — waiting for the bot'] : ['neutral', 'Not tested yet'];
  return (
    <div className="flex flex-col gap-5">
      {c ? (
        <div className="rounded-[12px] px-4 py-3.5 flex flex-col gap-3" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
          <div className="flex flex-wrap items-center gap-2 text-[13px]">
            <Pill tone="success">Connected</Pill>
            <span style={{ color: T.textBody }}>since {when(c.connectedAt)}{c.by ? ` by ${c.by}` : ''} · webhook at {c.host || '—'}</span>
            <Pill tone={testState[0]}>{testState[1]}</Pill>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnPrimary} disabled={busy} onClick={() => onRun(true)}>{busy ? 'Sending…' : 'Test connection'}</button>
            <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }} onClick={onRefresh}>Refresh</button>
            <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.danger }} onClick={disconnect}>Disconnect</button>
          </div>
          <p className="text-[12px]" style={{ color: T.textSecondary }}>Test connection sends a tiny job; the bot answers within a minute or two and the result shows in Activity. To change the webhook, paste a new one below.</p>
        </div>
      ) : <Banner tone="warning"><b>Not connected yet.</b> Paste the webhook of this bot&apos;s &ldquo;Casa-Libre job&rdquo; routine below.</Banner>}

      <div className="flex flex-col gap-3 max-w-2xl">
        <h3 className="text-[14px] font-bold" style={{ color: T.textPrimary }}>{c ? 'Replace the webhook' : 'Connect the bot'}</h3>
        <ol className="list-decimal pl-5 text-[12.5px] space-y-1" style={{ color: T.textBody }}>
          <li>In the Grok Bot desktop app open the bot, then Routines → &ldquo;Casa-Libre job&rdquo; → Webhook.</li>
          <li>Copy &ldquo;POST to&rdquo; and &ldquo;key&rdquo; into the fields below and press Save.</li>
          <li>Press Test connection.</li>
        </ol>
        <label className="text-[13px] font-semibold" htmlFor="wh-url" style={{ color: T.textPrimary }}>POST to</label>
        <input id="wh-url" className={inputCls} placeholder="https://api2.cursor.sh/automations/webhook/…" value={url} onChange={(e) => setUrl(e.target.value)} autoComplete="off" />
        <label className="text-[13px] font-semibold" htmlFor="wh-key" style={{ color: T.textPrimary }}>Key</label>
        <input id="wh-key" type="password" className={inputCls} placeholder="crsr_…" value={key} onChange={(e) => setKey(e.target.value)} autoComplete="off" />
        <p className="text-[12px]" style={{ color: T.textSecondary }}>The key is stored on the server only and is never shown again.</p>
        <div className="flex items-center gap-3">
          <button type="button" className={btnPrimary} disabled={saving || !url || !key} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
          {msg ? <span className="text-[12.5px]" role="status" style={{ color: msg.startsWith('Connected') ? T.success : T.danger }}>{msg}</span> : null}
        </div>
      </div>
    </div>
  );
}

function Settings({ bot, saved, onSave }) {
  const [s, setS] = useState(saved);
  const [errors, setErrors] = useState({});
  const [note, setNote] = useState('');
  useEffect(() => { setS(saved); setErrors({}); setNote(''); }, [bot.key, saved]);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const set = (k) => (v) => { setS((x) => ({ ...x, [k]: v })); setNote(''); };
  const save = () => {
    const e = validateBotSettings(bot, s);
    setErrors(e);
    if (Object.keys(e).length) { setNote('Fix the fields marked in red.'); return; }
    setNote(onSave(s) ? 'Saved in this browser.' : 'Could not save: this browser blocks storage.');
  };
  const common = COMMON_FIELDS.filter((f) => !f.showIf || f.showIf(s));
  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="text-[14px] font-bold" style={{ color: T.textPrimary }}>Schedule and limits</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {common.map((f) => <Field key={f.key} f={f} value={s[f.key]} error={errors[f.key]} onChange={set(f.key)} />)}
        </div>
      </section>
      <section className="flex flex-col gap-4 pt-5" style={{ borderTop: `1px solid ${T.borderLight}` }}>
        <h3 className="text-[14px] font-bold" style={{ color: T.textPrimary }}>What the bot works on</h3>
        {bot.fields.map((f) => <Field key={f.key} f={f} value={s[f.key]} error={errors[f.key]} onChange={set(f.key)} />)}
      </section>
      <div className="flex flex-wrap items-center gap-3 pt-4" style={{ borderTop: `1px solid ${T.borderLight}` }}>
        <button type="button" className={btnPrimary} onClick={save} disabled={!dirty}>Save settings</button>
        <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }} onClick={() => { setS(bot.defaults); setErrors({}); setNote('Defaults restored. Save to keep them.'); }}>Restore defaults</button>
        {note ? <span className="text-[12.5px]" role="status" style={{ color: note.startsWith('Saved') ? T.success : T.textSecondary }}>{note}</span> : null}
      </div>
    </div>
  );
}

export default function BotsPage() {
  const [store, setStore] = useState({});
  const [sel, setSel] = useState(BOTS[0].key);
  const [tab, setTab] = useState('activity');
  const [live, setLive] = useState(null);       // /api/bots: connections + runs
  const [liveErr, setLiveErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [runMsg, setRunMsg] = useState('');
  const load = useCallback(() => {
    fetch('/api/bots').then((r) => r.json()).then((j) => {
      if (j.error) setLiveErr(j.error); else if (j.pending) setLiveErr('pending'); else { setLiveErr(''); setLive(j.bots); }
    }).catch(() => setLiveErr('Could not load the bots. Reload the page.'));
  }, []);
  useEffect(() => { load(); }, [load]);
  const working = live ? Object.values(live).some((b) => b.runs.some((r) => r.status === 'sent')) : false;
  useEffect(() => {
    if (!working) return undefined;
    const t = setInterval(load, 10000);
    return () => clearInterval(t);
  }, [working, load]);
  useEffect(() => {
    setStore(readStore());
    try { const k = localStorage.getItem(SEL); if (botByKey(k)) setSel(k); } catch { /* ignore */ }
  }, []);
  const pick = (k) => { setSel(k); try { localStorage.setItem(SEL, k); } catch { /* ignore */ } };
  const bot = botByKey(sel);
  const settings = useMemo(() => Object.fromEntries(BOTS.map((b) => [b.key, mergeBotSettings(b, store[b.key])])), [store]);
  const save = (s) => { const next = { ...store, [bot.key]: s }; const ok = writeStore(next); setStore(next); return ok; };
  const tabs = [['activity', 'Activity'], ['settings', 'Settings'], ['connection', 'Connection']];
  const info = live?.[sel] || null;
  const run = async (test) => {
    setBusy(true); setRunMsg('');
    try {
      const j = await fetch(`/api/bots/${sel}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ test, settings: settings[sel] }) }).then((r) => r.json());
      if (j.error && !j.runId) setRunMsg(j.error);
      else if (!j.started) setRunMsg(j.error || 'Grok did not accept the job.');
      else setRunMsg(test ? 'Test sent. The bot answers in a minute or two; it shows in Activity.' : 'Job sent. Results appear in Activity when the bot reports back.');
      setTab('activity'); load();
    } catch { setRunMsg('Could not send the job. Try again.'); }
    setBusy(false);
  };

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Bots" sub="Grok collects outside data on a schedule, Claude analyses it, and a person approves anything that leaves Casa-Libre. Every run will be logged here." />
      {liveErr === 'pending' ? <Banner tone="warning"><b>Not set up yet.</b> Run <span className="font-mono">migrations/control/003_bots.sql</span> in the control DB (AiroBase SQL editor), then reload.</Banner> : liveErr ? <Banner>{liveErr}</Banner> : null}
      {runMsg ? <Banner tone="warning">{runMsg}</Banner> : null}

      <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
        <nav aria-label="Bots" className="flex flex-col gap-2">
          {BOTS.map((b) => {
            const s = settings[b.key];
            const active = b.key === sel;
            return (
              <button key={b.key} type="button" onClick={() => pick(b.key)} aria-current={active ? 'true' : undefined}
                className="text-left rounded-[14px] px-4 py-3.5 transition-colors focus-visible:outline focus-visible:outline-2"
                style={{ background: active ? T.bgWhite : 'transparent', border: `1px solid ${active ? T.primary : T.borderLight}` }}>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[14px] font-bold leading-snug" style={{ color: T.textPrimary }}>{b.name}</span>
                  <Pill tone="ink">{PRODUCT[b.product].label}</Pill>
                </div>
                <div className="flex items-center gap-2 mt-2 text-[12px]" style={{ color: T.textSecondary }}>
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: live?.[b.key]?.connected ? T.success : T.textMuted }} aria-hidden />
                  {live?.[b.key]?.connected ? 'Connected' : 'Not connected'} · {scheduleLabel(s)}
                </div>
              </button>
            );
          })}
        </nav>

        <section className="p-5 sm:p-6 flex flex-col gap-5 min-w-0" style={CARD}>
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[20px] font-bold tracking-head" style={{ color: T.textPrimary }}>{bot.name}</h2>
              <Pill tone="ink">{PRODUCT[bot.product].label}</Pill>
              <Pill tone={info?.connected ? 'success' : 'neutral'}>{info?.connected ? 'Connected' : 'Not connected'}</Pill>
              <Pill tone={settings[bot.key].enabled ? 'success' : 'neutral'}>{settings[bot.key].enabled ? 'Switched on' : 'Off'}</Pill>
            </div>
            <p className="text-[13.5px] leading-relaxed max-w-3xl" style={{ color: T.textBody }}>{bot.summary}</p>
            <Chain steps={bot.chain} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12.5px]">
              <div className="rounded-[12px] px-3.5 py-3" style={{ background: T.bgSurface }}>
                <div className="font-semibold mb-1" style={{ color: T.textPrimary }}>What it hands over</div>
                <div style={{ color: T.textBody }}>{bot.output}</div>
              </div>
              <div className="rounded-[12px] px-3.5 py-3" style={{ background: T.bgSurface }}>
                <div className="font-semibold mb-1" style={{ color: T.textPrimary }}>Rules it always follows</div>
                <ul className="list-disc pl-4 space-y-0.5" style={{ color: T.textBody }}>{bot.rules.map((r) => <li key={r}>{r}</li>)}</ul>
              </div>
            </div>
          </header>

          <div role="tablist" aria-label="Bot sections" className="flex gap-1 p-1 rounded-full self-start" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
            {tabs.map(([k, label]) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)}
                className="text-[13px] font-semibold px-4 py-1.5 rounded-full transition-colors"
                style={tab === k ? { background: T.primary, color: '#fff' } : { color: T.textSecondary }}>{label}</button>
            ))}
          </div>

          <div role="tabpanel">
            {tab === 'activity' ? <Activity bot={bot} info={info} onRefresh={load} onRun={run} busy={busy} /> : null}
            {tab === 'settings' ? <Settings bot={bot} saved={settings[bot.key]} onSave={save} /> : null}
            {tab === 'connection' ? <Connection bot={bot} info={info} onRefresh={load} onRun={run} busy={busy} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
