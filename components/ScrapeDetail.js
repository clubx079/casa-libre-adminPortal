'use client';
import Link from 'next/link';
import { useState, useRef, useEffect, useCallback } from 'react';
import { makeT, locale, pickLabel } from '@/lib/i18n';

function Field({ def, value, onChange, lang, t, disabled }) {
  const common =
    'px-3.5 py-2.5 border-[1.5px] border-ink/30 rounded-input bg-paper font-sans font-medium text-[14px] outline-none focus:border-ink w-full disabled:opacity-60';
  const label = pickLabel(def, lang);
  if (def.type === 'select') {
    return (
      <label className="flex flex-col gap-1 text-[12px] font-semibold">
        {label}
        <select className={common} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(def.key, e.target.value)}>
          <option value="">{t('card.any')}</option>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>{pickLabel(o, lang)}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold">
      {label}
      <input
        type={def.type === 'number' ? 'number' : 'text'}
        className={common}
        value={value ?? ''}
        disabled={disabled}
        placeholder={def.placeholder || ''}
        onChange={(e) => onChange(def.key, e.target.value)}
      />
    </label>
  );
}

const ICON = { insert: '＋', update: '↻', skip: '·', error: '✕' };
const TERMINAL = ['success', 'partial', 'failed', 'stopped'];

export default function ScrapeDetail({ source, lang }) {
  const t = makeT(lang);
  const loc = locale(lang);

  const initial = {};
  (source.filter_schema || []).forEach((f) => {
    if (f.default !== undefined) initial[f.key] = String(f.default);
    else if (source.default_filters?.[f.key] !== undefined) initial[f.key] = String(source.default_filters[f.key]);
  });
  const [filters, setFilters] = useState(initial);
  const setF = (k, v) => setFilters((p) => ({ ...p, [k]: v }));

  const [runId, setRunId] = useState(null);
  const [status, setStatus] = useState('idle'); // idle|running|paused|success|partial|failed|stopped
  const [progress, setProgress] = useState({ found: 0, inserted: 0, updated: 0, skipped: 0, images: 0, target: 0 });
  const [recent, setRecent] = useState([]);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false); // control button in-flight
  const logRef = useRef(null);
  const pollRef = useRef(null);

  // cron
  const [cronEnabled, setCronEnabled] = useState(!!source.cron_enabled);
  const [cronSchedule, setCronSchedule] = useState(source.cron_schedule || '0 3 * * *');
  const [savingCron, setSavingCron] = useState(false);
  const [cronMsg, setCronMsg] = useState('');

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [recent]);

  const applyRun = useCallback((run) => {
    if (!run) return;
    setStatus(run.status);
    const p = run.progress || {};
    setProgress({
      found: p.found ?? run.total_found ?? 0,
      inserted: p.inserted ?? run.inserted_count ?? 0,
      updated: p.updated ?? run.updated_count ?? 0,
      skipped: p.skipped ?? run.skipped_count ?? 0,
      images: p.images ?? run.images_uploaded ?? 0,
      target: p.target ?? 0,
    });
    if (Array.isArray(p.recent)) setRecent(p.recent);
  }, []);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  const startPolling = useCallback((id) => {
    stopPolling();
    const tick = async () => {
      try {
        const res = await fetch(`/api/scrape?runId=${id}`, { cache: 'no-store' });
        const { run } = await res.json();
        if (run) {
          applyRun(run);
          if (TERMINAL.includes(run.status)) stopPolling();
        }
      } catch { /* keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 1000);
  }, [applyRun, stopPolling]);

  // On mount: reconnect to an active run for this source (survive refresh).
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/scrape?sourceKey=${source.key}`, { cache: 'no-store' });
        const { run } = await res.json();
        if (alive && run) {
          setRunId(run.id);
          setNote(t('detail.reconnected'));
          applyRun(run);
          startPolling(run.id);
        }
      } catch { /* ignore */ }
    })();
    return () => { alive = false; stopPolling(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source.key]);

  async function startScrape() {
    setNote('');
    setRecent([]);
    setProgress({ found: 0, inserted: 0, updated: 0, skipped: 0, images: 0, target: 0 });
    setStatus('running');
    try {
      const clean = {};
      Object.entries(filters).forEach(([k, v]) => { if (v !== '' && v != null) clean[k] = v; });
      const res = await fetch('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceKey: source.key, filters: clean }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setRunId(data.runId);
      if (data.attached) setNote(t('detail.reconnected'));
      startPolling(data.runId);
    } catch (e) {
      setStatus('failed');
      setNote(e.message);
    }
  }

  async function control(action) {
    if (!runId) return;
    setBusy(true);
    try {
      await fetch('/api/scrape/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId, action }),
      });
      // optimistic: pause/resume reflected quickly by next poll
    } finally {
      setBusy(false);
    }
  }

  async function saveCron() {
    setSavingCron(true);
    setCronMsg('');
    try {
      const res = await fetch(`/api/sources/${source.key}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cron_enabled: cronEnabled, cron_schedule: cronSchedule }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error');
      setCronMsg(t('card.saved'));
    } catch (e) {
      setCronMsg(e.message);
    } finally {
      setSavingCron(false);
    }
  }

  const price = (v, cur) => (v == null ? '' : `${cur ? cur + ' ' : ''}${Number(v).toLocaleString(loc)}`);
  const fmt = (e) => {
    if (e.kind === 'page') return `${t('detail.page')} ${e.page} · ${e.fetched} ${t('ev.pageFetched')}`;
    if (e.kind === 'done') return `✓ ${t('ev.finished')}`;
    const bits = [ICON[e.action] || '·', e.title || e.id || ''];
    if (e.price != null) bits.push('· ' + price(e.price, e.currency));
    if (e.images) bits.push(`· ${e.images} ${t('ev.imgs')}`);
    if (e.error) bits.push('· ' + e.error);
    return bits.join(' ');
  };

  const pct = progress.target ? Math.min(100, Math.round((progress.found / progress.target) * 100)) : 0;
  const running = status === 'running';
  const paused = status === 'paused';
  const active = running || paused;

  const statusLabel =
    status === 'idle' ? '—'
    : running ? t('card.scraping')
    : paused ? t('detail.paused')
    : status === 'stopped' ? t('detail.stopped')
    : status === 'failed' ? t('detail.failed')
    : t('detail.done');

  return (
    <div>
      {/* header */}
      <div className="flex items-start gap-4 mb-6">
        <div className={`w-16 h-16 rounded-input grid place-items-center shrink-0 font-mono text-[11px] text-ink/45 overflow-hidden ${source.logo_url ? 'bg-card border border-ink/10 p-2' : 'cl-hatch'}`}>
          {source.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.logo_url} alt={source.name} className="w-full h-full object-contain" />
          ) : (
            source.key.slice(0, 4).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-[clamp(24px,3.5vw,34px)] tracking-head font-bold m-0">{source.name}</h1>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-pill ${source.is_active ? 'bg-ink text-paper' : 'bg-hatch1 text-ink/60'}`}>
              {source.is_active ? t('card.active') : t('card.inactive')}
            </span>
          </div>
          <p className="text-[14px] text-ink/55 mt-1 m-0 max-w-xl">{source.description}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-6 items-start">
        {/* LEFT — config */}
        <div className="bg-card border border-ink/15 rounded-card">
          <div className="p-6">
            <div className="font-mono text-[10px] uppercase tracking-label text-ink/50 mb-3">{t('card.filters')}</div>
            <div className="grid grid-cols-2 gap-3">
              {(source.filter_schema || []).map((def) => (
                <Field key={def.key} def={def} value={filters[def.key]} onChange={setF} lang={lang} t={t} disabled={active} />
              ))}
            </div>

            {/* action buttons */}
            {!active ? (
              <button
                onClick={startScrape}
                className="mt-5 w-full px-6 py-3.5 bg-ink text-paper font-semibold rounded-pill shadow-hard-soft flex items-center justify-center gap-2"
              >
                {t('card.scrapeNow')}
              </button>
            ) : (
              <div className="mt-5 flex gap-3">
                {running ? (
                  <button onClick={() => control('pause')} disabled={busy} className="flex-1 px-6 py-3.5 border-2 border-ink font-semibold rounded-pill disabled:opacity-60 flex items-center justify-center gap-2">
                    <span className="cl-spin w-3.5 h-3.5 border-2 border-ink/30 border-t-ink rounded-full" /> {t('ctl.pause')}
                  </button>
                ) : (
                  <button onClick={() => control('resume')} disabled={busy} className="flex-1 px-6 py-3.5 bg-ink text-paper font-semibold rounded-pill shadow-hard-soft disabled:opacity-60">
                    {t('ctl.resume')}
                  </button>
                )}
                <button onClick={() => control('stop')} disabled={busy} className="flex-1 px-6 py-3.5 border-2 border-ink font-semibold rounded-pill disabled:opacity-60">
                  {t('ctl.stop')}
                </button>
              </div>
            )}
          </div>

          {/* cron */}
          <div className="p-6 border-t border-ink/10 bg-paper/50">
            <div className="flex items-center justify-between mb-3">
              <div className="font-mono text-[10px] uppercase tracking-label text-ink/50">{t('card.cronTitle')}</div>
              <button
                onClick={() => setCronEnabled((e) => !e)}
                className={`px-3 py-1 rounded-pill text-[11px] font-semibold border-[1.5px] border-ink ${cronEnabled ? 'bg-ink text-paper' : 'bg-transparent text-ink'}`}
              >
                {cronEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex gap-2 items-end">
              <label className="flex flex-col gap-1 text-[12px] font-semibold flex-1">
                {t('card.cronExpr')}
                <input
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="0 3 * * *"
                  className="px-3.5 py-2.5 border-[1.5px] border-ink/30 rounded-input bg-paper font-mono text-[13px] outline-none focus:border-ink"
                />
              </label>
              <button onClick={saveCron} disabled={savingCron} className="px-5 py-2.5 border-2 border-ink font-semibold rounded-pill text-[13px] disabled:opacity-60">
                {savingCron ? t('card.saving') : t('card.save')}
              </button>
            </div>
            {cronMsg && <div className="font-mono text-[10px] text-ink/50 mt-2">{cronMsg}</div>}
            <div className="font-mono text-[10px] text-ink/40 mt-2 leading-relaxed">{t('card.cronHelp')}</div>
          </div>
        </div>

        {/* RIGHT — live progress */}
        <div className="bg-ink text-paper rounded-card p-6 lg:sticky lg:top-6">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-[10px] uppercase tracking-label text-paper/50">{t('detail.progressTitle')}</div>
            <span className="font-mono text-[10px] text-paper/60 flex items-center gap-1.5">
              {active && <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-paper' : 'bg-paper/50'}`} />}
              {statusLabel}
            </span>
          </div>

          <div className="grid grid-cols-4 gap-2 text-center mb-4">
            {[
              [t('card.found'), progress.found],
              [t('card.new'), progress.inserted],
              [t('card.updated'), progress.updated],
              [t('card.unchanged'), progress.skipped],
            ].map(([l, v]) => (
              <div key={l}>
                <div className="text-[24px] font-bold tracking-head">{v}</div>
                <div className="font-mono text-[9px] text-paper/50">{l}</div>
              </div>
            ))}
          </div>

          {/* plain-language summary when finished */}
          {['success', 'partial', 'stopped'].includes(status) && (
            <div className="mb-4 bg-paper text-ink rounded-input px-4 py-3">
              <div className="text-[13px] font-semibold">
                ✓ {progress.inserted} {t('card.new')} · {progress.updated} {t('card.updated')} · {progress.skipped} {t('card.unchanged')} — {t('detail.savedToDb')}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="font-mono text-[10px] text-ink/50">{progress.images} {t('card.imagesUploaded')}</span>
                <Link href="/properties" className="text-[12px] font-semibold underline">{t('detail.viewProps')}</Link>
              </div>
            </div>
          )}

          <div className="h-2 rounded-pill bg-paper/15 overflow-hidden mb-1">
            <div className="h-full bg-paper transition-all duration-300" style={{ width: `${pct}%` }} />
          </div>
          <div className="flex justify-between font-mono text-[10px] text-paper/50 mb-4">
            <span>{progress.images} {t('card.imagesUploaded')}</span>
            <span>{progress.target ? `${progress.found}/${progress.target}` : ''} {pct ? `· ${pct}%` : ''}</span>
          </div>

          <div ref={logRef} className="h-[340px] overflow-y-auto rounded-input bg-black/30 border border-paper/10 p-3 font-mono text-[11px] leading-relaxed">
            {recent.length === 0 ? (
              <div className="text-paper/40">{t('detail.logIdle')}</div>
            ) : (
              recent.map((e, i) => (
                <div
                  key={i}
                  className={
                    e.action === 'insert' ? 'text-paper'
                    : e.action === 'update' ? 'text-paper/80'
                    : e.action === 'error' ? 'text-paper font-semibold'
                    : e.kind === 'page' ? 'text-paper/60 mt-1'
                    : e.kind === 'done' ? 'text-paper font-semibold mt-1'
                    : 'text-paper/45'
                  }
                >
                  {fmt(e)}
                </div>
              ))
            )}
          </div>

          {note && <div className="mt-3 font-mono text-[11px] text-paper/70 bg-paper/10 rounded-input px-3 py-2">{note}</div>}
        </div>
      </div>
    </div>
  );
}
