'use client';
// Bots — the Grok bots that collect outside data for Claude (lib/grokBots.js). FRONT END ONLY for
// now: no bot is connected, nothing runs, and the settings are kept in this browser. Once a bot is
// wired up, every run lands in its activity log here (what it did, what it found, what it cost,
// what waits for approval) — the team's check on the bots.
import { useEffect, useMemo, useState } from 'react';
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

function Activity({ bot }) {
  const cols = ['When', 'What it did', 'Found', 'Cost', 'Result', 'Waiting for approval'];
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[['Runs this month', '0'], ['Items found', '0'], ['Spent this month', 'US$0.00'], ['Waiting for approval', '0']].map(([k, v]) => (
          <div key={k} className="rounded-[12px] px-3.5 py-3" style={{ background: T.bgSurface, border: `1px solid ${T.borderLight}` }}>
            <div className="text-[12px]" style={{ color: T.textSecondary }}>{k}</div>
            <div className="text-[20px] font-bold mt-0.5 tabular-nums" style={{ color: T.textPrimary }}>{v}</div>
          </div>
        ))}
      </div>
      <div className="overflow-x-auto rounded-[12px]" style={{ border: `1px solid ${T.borderLight}` }}>
        <table className="w-full text-[12.5px]">
          <thead>
            <tr style={{ background: T.bgSurface }}>{cols.map((c) => <th key={c} className="text-left font-semibold px-3 py-2.5 whitespace-nowrap" style={{ color: T.textSecondary }}>{c}</th>)}</tr>
          </thead>
          <tbody>
            <tr>
              <td colSpan={cols.length} className="px-4 py-10 text-center" style={{ color: T.textSecondary }}>
                <div className="font-semibold text-[13px]" style={{ color: T.textPrimary }}>No runs yet</div>
                <div className="mt-1 max-w-md mx-auto">Once {bot.name.toLowerCase()} is connected, every run shows up here: what it did, what it found, what it cost, and anything waiting for your approval.</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Connection({ bot }) {
  const p = PRODUCT[bot.product];
  const saves = { football: 'The football site\'s article queue', 'analyst-x': 'The outside-events list read by the AI Analyst', 'news-feed': 'The outside-events list read by the AI Analyst and AI SEO' }[bot.key];
  const rows = [['Runs on', 'Grok Bot (our Grok Pro account)'], ['Instructions', 'Written in plain language inside Grok, from the settings on this page'], ['Reports back to', `admin.casa-libre.com/api/bots/${bot.key}/run`], ...(saves ? [['Saves to', saves]] : []), ['Logins', 'The bot\'s own accounts, never a team member\'s']];
  return (
    <div className="flex flex-col gap-4">
      <Banner tone="warning"><b>Not connected yet.</b> {p.hint}.</Banner>
      <dl className="grid grid-cols-1 sm:grid-cols-[180px_1fr] gap-x-4 gap-y-2.5 text-[13px]">
        {rows.flatMap(([k, v]) => [<dt key={`${k}-k`} style={{ color: T.textSecondary }}>{k}</dt>, <dd key={`${k}-v`} style={{ color: T.textBody }}>{v}</dd>])}
      </dl>
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
  useEffect(() => {
    setStore(readStore());
    try { const k = localStorage.getItem(SEL); if (botByKey(k)) setSel(k); } catch { /* ignore */ }
  }, []);
  const pick = (k) => { setSel(k); try { localStorage.setItem(SEL, k); } catch { /* ignore */ } };
  const bot = botByKey(sel);
  const settings = useMemo(() => Object.fromEntries(BOTS.map((b) => [b.key, mergeBotSettings(b, store[b.key])])), [store]);
  const save = (s) => { const next = { ...store, [bot.key]: s }; const ok = writeStore(next); setStore(next); return ok; };
  const tabs = [['activity', 'Activity'], ['settings', 'Settings'], ['connection', 'Connection']];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader title="Bots" sub="Grok collects outside data on a schedule, Claude analyses it, and a person approves anything that leaves Casa-Libre. Every run will be logged here." />

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
                  <span className="inline-block w-2 h-2 rounded-full" style={{ background: T.textMuted }} aria-hidden />
                  Not connected · {scheduleLabel(s)}
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
              <Pill tone="neutral">Not connected</Pill>
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
            {tab === 'activity' ? <Activity bot={bot} /> : null}
            {tab === 'settings' ? <Settings bot={bot} saved={settings[bot.key]} onSave={save} /> : null}
            {tab === 'connection' ? <Connection bot={bot} /> : null}
          </div>
        </section>
      </div>
    </div>
  );
}
