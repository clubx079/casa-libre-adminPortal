'use client';
// Admin Manager → Security: the IP detector (lib/securityWatch.js, /api/manager/security).
// - Thresholds: events in 24 h from one IP — abroad / from the home country — and how many days
//   a block lasts. Saved per country.
// - Blocked IPs right now, each with why and until when; Unblock (the detector then leaves it alone).
// - Busiest IPs of the last 24 h, so you can see what the detector sees: over the limit → it is
//   blocked at the next hourly check ("Check now" runs it at once). Block by hand if needed.
import { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { T, CARD, Pill, Banner, fmtDate, btnSecondary } from '@/components/automations/ui';

const n = (v) => Number(v || 0).toLocaleString('en-US');

export default function SecurityCard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState(null);
  const [manual, setManual] = useState('');

  const apply = (j) => { if (j.error) setErr(j.error); else { setErr(''); setD(j); setForm(j.settings); } };
  const load = useCallback(() => {
    fetch('/api/manager/security').then((r) => r.json()).then(apply).catch(() => setErr('failed'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const post = async (body, key) => {
    setBusy(key);
    try { apply(await (await fetch('/api/manager/security', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()); }
    catch { setErr('failed'); }
    setBusy('');
  };

  const changed = d && form && ['abroadEvents', 'homeEvents', 'blockDays'].some((k) => Number(form[k]) !== d.settings[k]);
  const field = (k, label, hint) => (
    <label className="flex flex-col gap-1 text-[11px]" style={{ color: T.textSecondary }}>
      {label}
      <input type="number" min="1" value={form?.[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })}
        className="w-28 px-2.5 py-1.5 rounded-lg border text-[13px]" style={{ borderColor: T.borderLight, color: T.textPrimary }} data-testid={`sec-${k}`} />
      <span style={{ color: T.textMuted }}>{hint}</span>
    </label>
  );

  return (
    <div className="bg-white p-5 space-y-4" style={CARD} data-testid="security-card">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck className="w-4 h-4" style={{ color: T.textPrimary }} />
        <h2 className="text-sm font-bold" style={{ color: T.textPrimary }}>Security</h2>
        <span className="text-[11px]" style={{ color: T.textMuted }}>
          · one IP over the limit is blocked on the website (checked every hour). No country is blocked{d?.regionBlock?.length ? ` except ${d.regionBlock.length} by GEO_BLOCK` : ''}.
        </span>
        <button type="button" className={`${btnSecondary} ml-auto`} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => post({ action: 'run' }, 'run')}>
          {busy === 'run' ? 'Checking…' : 'Check now'}
        </button>
      </div>
      {err && <Banner>Could not load: {err}</Banner>}
      {d?.posthogError && <Banner tone="warning">PostHog: {d.posthogError}</Banner>}

      {/* thresholds */}
      <div className="flex flex-wrap items-end gap-4">
        {field('abroadEvents', 'Limit from abroad', 'events in 24 h, one IP')}
        {field('homeEvents', 'Limit from the home country', 'events in 24 h, one IP')}
        {field('blockDays', 'Block for', 'days')}
        <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!changed || !!busy}
          onClick={() => post({ action: 'settings', ...form }, 'settings')}>{busy === 'settings' ? 'Saving…' : 'Save limits'}</button>
      </div>
      <p className="text-[11px]" style={{ color: T.textMuted }}>
        A person reads a few dozen pages a day; a scraper hundreds. A shared network (many visitors on one IP, a few dozen events each) is not blocked.
      </p>

      {/* blocked now */}
      <div>
        <h3 className="text-xs font-semibold mb-2" style={{ color: T.textPrimary }}>Blocked IPs ({d?.blocked?.length ?? '…'})</h3>
        {d && !d.blocked.length && <p className="text-xs" style={{ color: T.textMuted }}>Nothing blocked right now.</p>}
        {d?.blocked?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr style={{ color: T.textMuted }}>{['IP', 'Why', 'Blocked', 'Until', ''].map((h) => <th key={h} className="text-left font-semibold py-1.5 pr-3">{h}</th>)}</tr></thead>
              <tbody>
                {d.blocked.map((b) => (
                  <tr key={b.ip} className="border-t" style={{ borderColor: T.borderLight }} data-testid="blocked-ip">
                    <td className="py-2 pr-3 font-mono">{b.ip}{b.country ? <span className="ml-1.5 font-sans" style={{ color: T.textMuted }}>{b.country}</span> : null}</td>
                    <td className="py-2 pr-3" style={{ color: T.textBody }}>{b.reason}</td>
                    <td className="py-2 pr-3 whitespace-nowrap" style={{ color: T.textSecondary }}>{fmtDate(b.at, true)}<span className="ml-1" style={{ color: T.textMuted }}>· {b.by}</span></td>
                    <td className="py-2 pr-3 whitespace-nowrap" style={{ color: T.textSecondary }}>{fmtDate(b.until)}</td>
                    <td className="py-2 text-right"><button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!!busy} onClick={() => post({ action: 'unblock', ip: b.ip }, `u:${b.ip}`)}>{busy === `u:${b.ip}` ? '…' : 'Unblock'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <input value={manual} onChange={(e) => setManual(e.target.value)} placeholder="Block an IP by hand, e.g. 102.89.1.20"
            className="w-64 px-2.5 py-1.5 rounded-lg border text-[12px] font-mono" style={{ borderColor: T.borderLight }} />
          <button type="button" className={btnSecondary} style={{ borderColor: T.borderLight }} disabled={!manual.trim() || !!busy}
            onClick={() => post({ action: 'block', ip: manual.trim() }, 'block').then(() => setManual(''))}>{busy === 'block' ? 'Blocking…' : 'Block'}</button>
        </div>
      </div>

      {/* what the detector sees */}
      <div>
        <h3 className="text-xs font-semibold mb-2" style={{ color: T.textPrimary }}>Busiest IPs, last 24 hours</h3>
        {d && !d.busiest.length && <p className="text-xs" style={{ color: T.textMuted }}>No IP with 20+ events in the last 24 hours.</p>}
        {d?.busiest?.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[640px]">
              <thead><tr style={{ color: T.textMuted }}>{['IP', 'Country', 'Events', 'Visitors', 'Property views', 'Detector'].map((h, i) => <th key={h} className={`font-semibold py-1.5 pr-3 ${i >= 2 && i <= 4 ? 'text-right' : 'text-left'}`}>{h}</th>)}</tr></thead>
              <tbody>
                {d.busiest.map((r) => (
                  <tr key={r.ip} className="border-t" style={{ borderColor: T.borderLight }}>
                    <td className="py-2 pr-3 font-mono">{r.ip}</td>
                    <td className="py-2 pr-3" style={{ color: T.textBody }}>{r.countryName || r.country || '—'}</td>
                    <td className="py-2 pr-3 text-right">{n(r.events)}</td>
                    <td className="py-2 pr-3 text-right">{n(r.visitors)}</td>
                    <td className="py-2 pr-3 text-right">{n(r.views)}</td>
                    <td className="py-2 pr-3">
                      {r.blocked ? <Pill tone="danger">Blocked</Pill>
                        : r.team ? <Pill>Team</Pill>
                        : r.allowed ? <Pill>Allowed by an admin</Pill>
                        : r.suspicious ? <span title={r.reason || ''}><Pill tone="warning">Over the limit: blocked at the next check</Pill></span>
                        : <span style={{ color: T.textMuted }}>OK</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {d?.unblocked?.length > 0 && (
        <p className="text-[11px]" style={{ color: T.textMuted }}>
          Unblocked by an admin (never blocked again by itself): {d.unblocked.map((b) => `${b.ip} (${b.unblocked_by || 'admin'})`).join(', ')}
        </p>
      )}
    </div>
  );
}
