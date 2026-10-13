'use client';
// Mobile app updates — which app versions get the "Update available" sheet (dismissible)
// and which get "Update required" (blocking), for Android and iPhone. Saved to every
// country database at once; the websites serve it to the app within ~1 minute. While
// the switch is off, or a field is empty, each site keeps using its env vars.
// Settings: lib/appUpdatesAdmin.js · API: /api/app-updates.
import { useEffect, useState } from 'react';
import { T, CARD, PageHeader, Banner, Pill, fmtDate, inputCls, btnPrimary, btnSecondary } from '@/components/automations/ui';
import { compareVersions } from '@/lib/appUpdatesAdmin';

const PLAT = [['android', 'Android (Google Play)'], ['ios', 'iPhone (App Store)']];

function Field({ label, help, error, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-semibold mb-1" style={{ color: T.textPrimary }}>{label}</span>
      {children}
      {help && <span className="block text-[12px] mt-1 leading-snug" style={{ color: T.textSecondary }}>{help}</span>}
      {error && <span className="block text-[12px] mt-1 font-medium" style={{ color: T.danger }}>{error}</span>}
    </label>
  );
}

function LiveCell({ v }) {
  if (!v) return <span style={{ color: T.textMuted }}>—</span>;
  if (v.error) return <span style={{ color: T.textMuted }}>{v.error}</span>;
  return (
    <span className="whitespace-nowrap">
      latest <b>{v.latest}</b> · min <b>{v.min}</b>{' '}
      <Pill tone={v.source === 'admin' ? 'success' : 'neutral'}>{v.source === 'admin' ? 'this page' : 'server env'}</Pill>
    </span>
  );
}

export default function AppUpdatesPage() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [errors, setErrors] = useState({});
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const load = () => fetch('/api/app-updates', { cache: 'no-store' }).then((r) => r.json())
    .then((j) => { if (j.error) setLoadErr(j.error); else { setData(j); setForm(j.settings); } })
    .catch((e) => setLoadErr(String(e)));
  useEffect(() => { load(); }, []);

  const setPlat = (scope, p, k) => (e) => setForm((f) => (scope === 'test'
    ? { ...f, test: { ...f.test, [p]: { ...f.test[p], [k]: e.target.value } } }
    : { ...f, [p]: { ...f[p], [k]: e.target.value } }));

  async function save() {
    // Raising a minimum walls everyone below it — make sure the build is in the store.
    const prev = data.settings;
    const raised = PLAT.filter(([p]) => form[p].min && (!prev[p].min || compareVersions(form[p].min, prev[p].min) > 0));
    if (form.enabled && raised.length && !window.confirm(`You are raising the MINIMUM version (${raised.map(([p, l]) => `${l}: ${form[p].min}`).join(', ')}).\n\nEveryone with an older app will be BLOCKED until they update. Only do this when that version is live in the store.\n\nSave?`)) return;
    setBusy(true); setMsg(null); setErrors({});
    try {
      const r = await fetch('/api/app-updates', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json();
      if (r.status === 400) { setErrors(j.errors || {}); setMsg({ tone: 'error', text: 'Fix the highlighted fields.' }); return; }
      const failed = (j.results || []).filter((x) => !x.ok);
      setMsg(failed.length
        ? { tone: 'error', text: `Saved in ${j.results.length - failed.length} of ${j.results.length} countries. Failed: ${failed.map((x) => `${x.name} (${x.error})`).join('; ')}` }
        : { tone: 'success', text: `Saved in all ${j.results.length} countries. Phones pick it up within about a minute.` });
      await load();
    } catch (e) { setMsg({ tone: 'error', text: String(e) }); } finally { setBusy(false); }
  }

  if (loadErr) return <div className="p-6"><Banner>{loadErr}</Banner></div>;
  if (!data || !form) return <div className="p-6 text-[13px]" style={{ color: T.textMuted }}>Loading…</div>;

  return (
    <div className="space-y-5">
      <PageHeader title="Mobile app updates" sub="Tell people with an older app to update — optional or required. Applies to every country at once." />

      <div className="rounded-[14px] p-5 text-[13px] leading-relaxed space-y-1.5" style={CARD}>
        <div><b>Latest version</b> — anyone below it sees <b>“Update available”</b> with an <i>Update later</i> button (asked again after 24 h).</div>
        <div><b>Minimum version</b> — anyone below it sees <b>“Update required”</b>: one button to the store, the app can’t be used until they update. ⚠️ Only raise it once that version is live in the store.</div>
        <div style={{ color: T.textSecondary }}>Leave a field empty to keep what the website’s server settings (env) say. With the switch off, nothing here is used.</div>
      </div>

      <div className="rounded-[14px] p-5 space-y-5" style={CARD}>
        <label className="flex items-center gap-3 cursor-pointer">
          <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} className="w-4 h-4" data-testid="au-enabled" />
          <span className="text-[14px] font-semibold" style={{ color: T.textPrimary }}>Use these settings</span>
          <Pill tone={form.enabled ? 'success' : 'neutral'}>{form.enabled ? 'On — overrides the server env' : 'Off — sites use their server env'}</Pill>
        </label>

        <div className="grid gap-5 md:grid-cols-2">
          {PLAT.map(([p, label]) => (
            <div key={p} className="space-y-3 rounded-[12px] border p-4" style={{ borderColor: T.borderLight }}>
              <div className="text-[14px] font-bold" style={{ color: T.textPrimary }}>{label}</div>
              <Field label="Latest version (optional update)" error={errors[`${p}.latest`]} help="e.g. 1.4.0">
                <input value={form[p].latest} onChange={setPlat('', p, 'latest')} placeholder="from server env" className={inputCls} data-testid={`au-${p}-latest`} />
              </Field>
              <Field label="Minimum version (required update)" error={errors[`${p}.min`]} help="Below this the app is blocked until updated.">
                <input value={form[p].min} onChange={setPlat('', p, 'min')} placeholder="from server env" className={inputCls} data-testid={`au-${p}-min`} />
              </Field>
              <Field label="Store link (optional)" error={errors[`${p}.storeUrl`]} help="Empty = the normal store page.">
                <input value={form[p].storeUrl} onChange={setPlat('', p, 'storeUrl')} placeholder="default store page" className={inputCls} />
              </Field>
            </div>
          ))}
        </div>

        <details className="rounded-[12px] border p-4" style={{ borderColor: T.borderLight }}>
          <summary className="cursor-pointer text-[13.5px] font-semibold" style={{ color: T.textPrimary }}>Test mode — try the sheets on your own phone first</summary>
          <div className="mt-3 space-y-3">
            <Field label="Tester emails" error={errors.testEmails} help="Only these signed-in accounts get the test versions below; everyone else keeps the normal ones.">
              <input value={form.testEmails} onChange={(e) => setForm((f) => ({ ...f, testEmails: e.target.value }))} placeholder="omar@airosofts.com, hamza@…" className={inputCls} />
            </Field>
            <div className="grid gap-3 md:grid-cols-2">
              {PLAT.map(([p, label]) => (
                <div key={p} className="grid grid-cols-2 gap-3">
                  <Field label={`${label.split(' ')[0]} · test latest`} error={errors[`test.${p}.latest`]}>
                    <input value={form.test[p].latest} onChange={setPlat('test', p, 'latest')} placeholder="e.g. 9.9.9" className={inputCls} />
                  </Field>
                  <Field label={`${label.split(' ')[0]} · test minimum`} error={errors[`test.${p}.min`]}>
                    <input value={form.test[p].min} onChange={setPlat('test', p, 'min')} placeholder="e.g. 9.9.9" className={inputCls} />
                  </Field>
                </div>
              ))}
            </div>
            <p className="text-[12px]" style={{ color: T.textSecondary }}>9.9.9 as test latest shows “Update available”; as test minimum, “Update required”. Clear these when done.</p>
          </div>
        </details>

        {msg && (msg.tone === 'success'
          ? <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.successSurface, color: T.success }} data-testid="au-msg">{msg.text}</div>
          : <Banner>{msg.text}</Banner>)}
        <div className="flex items-center gap-3">
          <button onClick={save} disabled={busy} className={btnPrimary} data-testid="au-save">{busy ? 'Saving…' : `Save for all ${data.countries.length} countries`}</button>
          {data.settings.updatedAt && <span className="text-[12px]" style={{ color: T.textMuted }}>Last saved {fmtDate(data.settings.updatedAt, true)}</span>}
        </div>
      </div>

      <div className="rounded-[14px] p-5" style={CARD}>
        <div className="flex items-center justify-between mb-3">
          <div className="text-[15px] font-bold" style={{ color: T.textPrimary }}>What each website tells the app right now</div>
          <button onClick={load} className={btnSecondary} style={{ borderColor: T.borderLight }}>Refresh</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead><tr className="text-left" style={{ color: T.textMuted }}>
              <th className="py-2 pr-3 font-medium">Country</th><th className="py-2 pr-3 font-medium">Saved here</th>
              <th className="py-2 pr-3 font-medium">Android</th><th className="py-2 font-medium">iPhone</th>
            </tr></thead>
            <tbody>
              {data.countries.map((c) => (
                <tr key={c.cc} className="border-t" style={{ borderColor: T.borderLight }}>
                  <td className="py-2 pr-3 font-medium">{c.name}</td>
                  <td className="py-2 pr-3">
                    {c.dbError ? <Pill tone="danger">DB error</Pill> : !c.saved ? <Pill tone="neutral">not yet</Pill> : <Pill tone={c.enabled ? 'success' : 'neutral'}>{c.enabled ? 'on' : 'off'}</Pill>}
                    {c.differs && <span className="ml-1"><Pill tone="warning">different</Pill></span>}
                  </td>
                  <td className="py-2 pr-3"><LiveCell v={c.live?.android} /></td>
                  <td className="py-2"><LiveCell v={c.live?.ios} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[12px] mt-2" style={{ color: T.textSecondary }}>“server env” = the site still uses its own settings (until it is redeployed with this feature, or while the switch is off). The sites cache this page’s values for up to 1 minute.</p>
      </div>
    </div>
  );
}
