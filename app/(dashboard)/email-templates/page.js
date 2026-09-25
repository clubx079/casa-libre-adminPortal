'use client';
// Email templates — list. Built-in templates (used by the automation) can be edited
// but not deleted; custom templates can be created, duplicated and deleted.
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Mail } from 'lucide-react';
import { T, CARD, PageHeader, Pill, Banner, PendingMigration, fmtDate, btnPrimary, btnSecondary } from '@/components/automations/ui';

export default function EmailTemplatesPage() {
  const router = useRouter();
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState(null);

  async function load() {
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/email-templates', { cache: 'no-store' });
      const j = await res.json();
      if (j.pending) setPending(true);
      else if (!res.ok) setError(j.error || `HTTP ${res.status}`);
      else setRows(j.rows || []);
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, []);

  async function duplicate(t) {
    setBusyId(t.id);
    try {
      const res = await fetch('/api/email-templates', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `${t.name} (copy)`, subject: t.subject, heading: t.heading, body: t.body, button_label: t.button_label, button_url: t.button_url }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || j.error);
      router.push(`/email-templates/${j.row.id}`);
    } catch (e) { setError(`Could not duplicate: ${e.message}`); setBusyId(null); }
  }

  async function del(t) {
    if (!window.confirm(`Delete the template "${t.name}"? This can't be undone.`)) return;
    setBusyId(t.id);
    try {
      const res = await fetch(`/api/email-templates/${t.id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || j.error);
      setRows((r) => r.filter((x) => x.id !== t.id));
    } catch (e) { setError(`Could not delete: ${e.message}`); }
    finally { setBusyId(null); }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Email templates"
        sub="The emails Casa Libre sends automatically. Edit the wording here; the Casa Libre design is added for you."
        action={!pending && <Link href="/email-templates/new" className={btnPrimary}>New template</Link>}
      />

      {error && <Banner>{error}</Banner>}
      {pending && <PendingMigration />}

      {!pending && (
        <div className="overflow-hidden" style={CARD}>
          <div className="cl-scroll overflow-x-auto">
            <table className="w-full min-w-[860px]">
              <thead style={{ background: T.bgSurface, borderBottom: `1px solid ${T.borderLight}` }}>
                <tr>
                  {['Template', 'Subject', 'Used by', 'Sent', 'Status', ''].map((h, i) => (
                    <th key={i} className={`px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider ${i === 5 ? 'text-right' : 'text-left'}`} style={{ color: T.textMuted }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-xs" style={{ color: T.textMuted }}>Loading…</td></tr>
                ) : rows.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-12 text-center">
                    <Mail className="w-10 h-10 mx-auto mb-3" style={{ color: T.borderLight }} />
                    <p className="text-sm font-medium" style={{ color: T.textSecondary }}>No templates yet</p>
                    <p className="text-xs mt-1" style={{ color: T.textMuted }}>Create one with “New template”.</p>
                  </td></tr>
                ) : rows.map((t) => (
                  <tr key={t.id} className="border-b transition-colors hover:bg-[#FAF7F1]" style={{ borderColor: T.borderLight }}>
                    <td className="px-4 py-3 max-w-[240px]">
                      <Link href={`/email-templates/${t.id}`} className="text-[13px] font-medium hover:underline" style={{ color: T.textPrimary }}>{t.name}</Link>
                      <div className="mt-0.5">{t.key ? <span className="text-[10px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>Built-in</span> : <span className="text-[10px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>Custom</span>}</div>
                    </td>
                    <td className="px-4 py-3 text-xs max-w-[280px] truncate" style={{ color: T.textBody }} title={t.subject}>{t.subject}</td>
                    <td className="px-4 py-3 text-xs" style={{ color: T.textBody }}>{t.usedBy.length ? t.usedBy.join(', ') : <span style={{ color: T.textMuted }}>—</span>}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap" style={{ color: T.textBody }}>
                      {t.sentCount.toLocaleString('en-US')}
                      {t.lastSentAt && <span className="block text-[11px]" style={{ color: T.textMuted }}>last {fmtDate(t.lastSentAt)}</span>}
                    </td>
                    <td className="px-4 py-3">{t.is_active ? <Pill tone="success">Active</Pill> : <Pill>Off</Pill>}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Link href={`/email-templates/${t.id}`} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }}>Edit</Link>
                        <button onClick={() => duplicate(t)} disabled={busyId === t.id} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }}>Duplicate</button>
                        {!t.key && !t.usedBy.length && (
                          <button onClick={() => del(t)} disabled={busyId === t.id} className={btnSecondary} style={{ borderColor: T.danger, color: T.danger }}>Delete</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
