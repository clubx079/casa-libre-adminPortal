'use client';
import Link from 'next/link';
import { useState, useRef, useEffect, useCallback } from 'react';
import { makeT, locale, pickLabel } from '@/lib/i18n';

const T = {
  textPrimary: '#111111',
  textBody: '#3A3A37',
  textSecondary: '#6B6862',
  textMuted: '#9C978C',
  bgWhite: '#FFFFFF',
  bgSurface: '#FAF7F1',
  borderLight: '#E7E1D6',
};
const CARD = { border: `1px solid ${T.borderLight}`, borderRadius: '14px' };

const fieldStyle = { padding: '8px 14px', fontSize: '13px', border: `1px solid ${T.borderLight}`, borderRadius: '10px', background: T.bgWhite, color: T.textBody };

function Field({ def, value, onChange, lang, t, disabled }) {
  const label = pickLabel(def, lang);
  if (def.type === 'select') {
    return (
      <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: T.textSecondary }}>
        {label}
        <select className="w-full outline-none disabled:opacity-60" style={fieldStyle} value={value ?? ''} disabled={disabled} onChange={(e) => onChange(def.key, e.target.value)}>
          <option value="">{t('card.any')}</option>
          {def.options?.map((o) => (
            <option key={o.value} value={o.value}>{pickLabel(o, lang)}</option>
          ))}
        </select>
      </label>
    );
  }
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: T.textSecondary }}>
      {label}
      <input
        type={def.type === 'number' ? 'number' : 'text'}
        className="w-full outline-none disabled:opacity-60"
        style={fieldStyle}
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
    <div className="space-y-5">
      {/* header */}
      <div className="flex items-start gap-4">
        <div
          className="w-14 h-14 shrink-0 flex items-center justify-center overflow-hidden text-[11px] font-semibold"
          style={{ borderRadius: '12px', background: T.bgSurface, color: T.textMuted }}
        >
          {source.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={source.logo_url} alt={source.name} className="w-full h-full object-contain" />
          ) : (
            source.key.slice(0, 4).toUpperCase()
          )}
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>{source.name}</h1>
            <span
              className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
              style={source.is_active ? { background: T.textPrimary, color: T.bgWhite } : { background: T.bgSurface, color: T.textSecondary }}
            >
              {source.is_active ? t('card.active') : t('card.inactive')}
            </span>
          </div>
          <p className="text-[13px] mt-0.5 max-w-xl" style={{ color: T.textSecondary }}>{source.description}</p>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-5 items-start">
        {/* LEFT — config */}
        <div className="bg-white overflow-hidden" style={CARD}>
          <div className="p-5">
            <h2 className="text-sm font-bold mb-3" style={{ color: T.textPrimary }}>{t('card.filters')}</h2>
            <div className="grid grid-cols-2 gap-3">
              {(source.filter_schema || []).map((def) => (
                <Field key={def.key} def={def} value={filters[def.key]} onChange={setF} lang={lang} t={t} disabled={active} />
              ))}
            </div>

            {/* action buttons */}
            {!active ? (
              <button
                onClick={startScrape}
                className="mt-5 w-full px-6 py-3 text-[13px] font-semibold rounded-full flex items-center justify-center gap-2"
                style={{ background: T.textPrimary, color: T.bgWhite }}
              >
                {t('card.scrapeNow')}
              </button>
            ) : (
              <div className="mt-5 flex gap-3">
                {running ? (
                  <button
                    onClick={() => control('pause')} disabled={busy}
                    className="flex-1 px-6 py-3 text-[13px] font-semibold rounded-full disabled:opacity-60 flex items-center justify-center gap-2"
                    style={{ border: `1px solid ${T.borderLight}`, color: T.textPrimary }}
                  >
                    <span className="cl-spin w-3.5 h-3.5 rounded-full" style={{ border: `2px solid ${T.borderLight}`, borderTopColor: T.textPrimary }} /> {t('ctl.pause')}
                  </button>
                ) : (
                  <button
                    onClick={() => control('resume')} disabled={busy}
                    className="flex-1 px-6 py-3 text-[13px] font-semibold rounded-full disabled:opacity-60"
                    style={{ background: T.textPrimary, color: T.bgWhite }}
                  >
                    {t('ctl.resume')}
                  </button>
                )}
                <button
                  onClick={() => control('stop')} disabled={busy}
                  className="flex-1 px-6 py-3 text-[13px] font-semibold rounded-full disabled:opacity-60"
                  style={{ border: `1px solid ${T.borderLight}`, color: T.textPrimary }}
                >
                  {t('ctl.stop')}
                </button>
              </div>
            )}
          </div>

          {/* cron */}
          <div className="p-5 border-t" style={{ borderColor: T.borderLight, background: T.bgSurface }}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>{t('card.cronTitle')}</h2>
              <button
                onClick={() => setCronEnabled((e) => !e)}
                className="px-3 py-1 rounded-full text-[11px] font-semibold"
                style={cronEnabled ? { background: T.textPrimary, color: T.bgWhite } : { border: `1px solid ${T.borderLight}`, color: T.textSecondary, background: 'transparent' }}
              >
                {cronEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <div className="flex gap-2 items-end">
              <label className="flex flex-col gap-1 text-[12px] font-semibold flex-1" style={{ color: T.textSecondary }}>
                {t('card.cronExpr')}
                <input
                  value={cronSchedule}
                  onChange={(e) => setCronSchedule(e.target.value)}
                  placeholder="0 3 * * *"
                  className="outline-none font-mono text-[13px]"
                  style={{ padding: '8px 14px', border: `1px solid ${T.borderLight}`, borderRadius: '10px', background: T.bgWhite, color: T.textBody }}
                />
              </label>
              <button
                onClick={saveCron} disabled={savingCron}
                className="px-5 py-2 text-[13px] font-semibold rounded-full disabled:opacity-60"
                style={{ border: `1px solid ${T.borderLight}`, color: T.textPrimary }}
              >
                {savingCron ? t('card.saving') : t('card.save')}
              </button>
            </div>
            {cronMsg && <div className="text-[11px] mt-2" style={{ color: T.textSecondary }}>{cronMsg}</div>}
            <div className="text-[11px] mt-2 leading-relaxed" style={{ color: T.textMuted }}>{t('card.cronHelp')}</div>
          </div>
        </div>

        {/* RIGHT — live progress */}
        <div className="bg-white p-5 lg:sticky lg:top-6" style={CARD}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>{t('detail.progressTitle')}</h2>
            <span className="text-[11px] font-semibold flex items-center gap-1.5" style={{ color: T.textSecondary }}>
              {active && <span className="w-1.5 h-1.5 rounded-full" style={{ background: running ? T.textPrimary : T.borderLight }} />}
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
                <div className="text-2xl font-bold tracking-head" style={{ color: T.textPrimary }}>{v}</div>
                <div className="text-[10px] mt-0.5" style={{ color: T.textMuted }}>{l}</div>
              </div>
            ))}
          </div>

          {/* plain-language summary when finished */}
          {['success', 'partial', 'stopped'].includes(status) && (
            <div className="mb-4 px-4 py-3" style={{ background: T.bgSurface, borderRadius: '10px' }}>
              <div className="text-[13px] font-semibold" style={{ color: T.textPrimary }}>
                ✓ {progress.inserted} {t('card.new')} · {progress.updated} {t('card.updated')} · {progress.skipped} {t('card.unchanged')} — {t('detail.savedToDb')}
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-[11px]" style={{ color: T.textMuted }}>{progress.images} {t('card.imagesUploaded')}</span>
                <Link href="/properties" className="text-[12px] font-semibold underline" style={{ color: T.textPrimary }}>{t('detail.viewProps')}</Link>
              </div>
            </div>
          )}

          <div className="h-2 rounded-full overflow-hidden mb-1" style={{ background: T.bgSurface }}>
            <div className="h-full transition-all duration-300" style={{ width: `${pct}%`, background: T.textPrimary }} />
          </div>
          <div className="flex justify-between text-[10px] mb-4" style={{ color: T.textMuted }}>
            <span>{progress.images} {t('card.imagesUploaded')}</span>
            <span>{progress.target ? `${progress.found}/${progress.target}` : ''} {pct ? `· ${pct}%` : ''}</span>
          </div>

          <div
            ref={logRef}
            className="cl-scroll h-[340px] overflow-y-auto p-3 font-mono text-[11px] leading-relaxed"
            style={{ borderRadius: '10px', background: T.bgSurface, border: `1px solid ${T.borderLight}` }}
          >
            {recent.length === 0 ? (
              <div style={{ color: T.textMuted }}>{t('detail.logIdle')}</div>
            ) : (
              recent.map((e, i) => (
                <div
                  key={i}
                  style={{
                    color:
                      e.action === 'insert' ? T.textPrimary
                      : e.action === 'update' ? T.textBody
                      : e.action === 'error' ? T.textPrimary
                      : e.kind === 'page' ? T.textSecondary
                      : e.kind === 'done' ? T.textPrimary
                      : T.textMuted,
                    fontWeight: e.action === 'error' || e.kind === 'done' ? 600 : 400,
                    marginTop: e.kind === 'page' || e.kind === 'done' ? '4px' : 0,
                  }}
                >
                  {fmt(e)}
                </div>
              ))
            )}
          </div>

          {note && (
            <div className="mt-3 text-[11px] px-3 py-2" style={{ color: T.textSecondary, background: T.bgSurface, borderRadius: '10px' }}>
              {note}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
