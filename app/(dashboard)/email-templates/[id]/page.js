'use client';
// Email template editor — fields on the left, a live preview on the right rendered by
// the SAME renderer the buyer portal sends with (lib/emailTemplateRender.js), inside
// the Casa Libre frame, filled with sample data. /email-templates/new creates one.
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { renderTemplate, sampleVars, templateVars } from '@/lib/emailTemplateRender';
import { BADGE_APPLE_PNG, BADGE_PLAY_PNG } from '@/lib/emailBadges';
import { countryFrame, validateTemplate } from '@/lib/automationAdmin';
import { T, CARD, PageHeader, Banner, PendingMigration, inputCls, btnPrimary, btnSecondary, fmtDate } from '@/components/automations/ui';

const EMPTY = { name: '', subject: '', heading: '', body: '', button_label: '', button_url: '', is_active: true };
const FIELDS = ['subject', 'heading', 'body', 'button_label', 'button_url'];

function Label({ children, hint }) {
  return (
    <label className="flex items-baseline justify-between gap-2 text-[12px] font-medium text-ink/70 mb-1.5">
      <span>{children}</span>
      {hint ? <span className="text-[11px] font-normal" style={{ color: T.textMuted }}>{hint}</span> : null}
    </label>
  );
}

export default function TemplateEditor({ params }) {
  const router = useRouter();
  const isNew = params.id === 'new';
  const [form, setForm] = useState(EMPTY);
  const [meta, setMeta] = useState({ key: null, usedBy: [], updated_at: null });
  const [country, setCountry] = useState('py');
  const [loading, setLoading] = useState(!isNew);
  const [pending, setPending] = useState(false);
  const [errors, setErrors] = useState({});
  const [notice, setNotice] = useState(null); // { tone, text }
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const refs = useRef({});
  const lastField = useRef('body');
  // "Preview in English": translated copy of the text fields, preview only.
  const [english, setEnglish] = useState(false);
  const [tr, setTr] = useState(null);
  const [trState, setTrState] = useState(''); // '' | 'loading' | 'error'

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(isNew ? '/api/email-templates' : `/api/email-templates/${params.id}`, { cache: 'no-store' });
        const j = await res.json();
        if (!alive) return;
        if (j.pending) { setPending(true); return; }
        if (!res.ok) { setNotice({ tone: 'error', text: j.error === 'not_found' ? 'This template no longer exists.' : (j.error || `HTTP ${res.status}`) }); return; }
        if (j.country) setCountry(j.country);
        if (!isNew && j.row) {
          const r = j.row;
          setForm({ name: r.name || '', subject: r.subject || '', heading: r.heading || '', body: r.body || '', button_label: r.button_label || '', button_url: r.button_url || '', is_active: r.is_active !== false });
          setMeta({ key: r.key, usedBy: r.usedBy || [], updated_at: r.updated_at });
        }
      } catch (e) { if (alive) setNotice({ tone: 'error', text: String(e.message || e) }); }
      finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [isNew, params.id]);

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    const h = (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty]);

  const set = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((er) => (er[k] ? { ...er, [k]: undefined } : er));
    setDirty(true);
  };

  // Variable chips insert {{var}} at the cursor of the last field you were in.
  function insertVar(key) {
    const field = lastField.current;
    const el = refs.current[field];
    const tag = `{{${key}}}`;
    const cur = form[field] || '';
    const start = el?.selectionStart ?? cur.length;
    const end = el?.selectionEnd ?? cur.length;
    const next = cur.slice(0, start) + tag + cur.slice(end);
    setForm((f) => ({ ...f, [field]: next }));
    setDirty(true);
    requestAnimationFrame(() => { if (el) { el.focus(); el.setSelectionRange(start + tag.length, start + tag.length); } });
  }

  // Re-translate (after a short pause in typing) while the English preview is on.
  useEffect(() => {
    if (!english) return undefined;
    let alive = true;
    setTrState('loading');
    const id = setTimeout(async () => {
      try {
        const res = await fetch('/api/email-templates/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
        const j = await res.json();
        if (!alive) return;
        if (!res.ok) throw new Error(j.message || 'failed');
        setTr({ subject: j.subject, heading: j.heading, body: j.body, button_label: j.button_label });
        setTrState('');
      } catch { if (alive) setTrState('error'); }
    }, 700);
    return () => { alive = false; clearTimeout(id); };
  }, [english, form.subject, form.heading, form.body, form.button_label]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = english && tr ? { ...form, ...tr } : form;
  const preview = useMemo(() => renderTemplate(shown, sampleVars, countryFrame(country, {
    appleSrc: `data:image/png;base64,${BADGE_APPLE_PNG}`,
    playSrc: `data:image/png;base64,${BADGE_PLAY_PNG}`,
  })), [shown, country]); // eslint-disable-line react-hooks/exhaustive-deps

  function check() {
    const v = validateTemplate(form);
    setErrors(v.errors);
    return v.ok;
  }

  async function save() {
    if (!check()) { setNotice({ tone: 'error', text: 'Fix the highlighted fields.' }); return; }
    setBusy('save'); setNotice(null);
    try {
      const res = await fetch(isNew ? '/api/email-templates' : `/api/email-templates/${params.id}`, {
        method: isNew ? 'POST' : 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form),
      });
      const j = await res.json();
      if (res.status === 400 && j.errors) { setErrors(j.errors); throw new Error('Fix the highlighted fields.'); }
      if (j.pending) { setPending(true); return; }
      if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
      setDirty(false);
      if (isNew) { router.replace(`/email-templates/${j.row.id}`); return; }
      setMeta((m) => ({ ...m, updated_at: j.row?.updated_at || new Date().toISOString(), usedBy: j.row?.usedBy || m.usedBy }));
      setNotice({ tone: 'success', text: 'Saved.' });
    } catch (e) { setNotice({ tone: 'error', text: e.message }); }
    finally { setBusy(''); }
  }

  async function sendTest() {
    if (!check()) { setNotice({ tone: 'error', text: 'Fix the highlighted fields before sending a test.' }); return; }
    setBusy('test'); setNotice(null);
    try {
      const res = await fetch(`/api/email-templates/${params.id}/test`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || j.error || `HTTP ${res.status}`);
      setNotice({ tone: 'success', text: `Test sent to ${j.to}, with sample data.` });
    } catch (e) { setNotice({ tone: 'error', text: `Test not sent: ${e.message}` }); }
    finally { setBusy(''); }
  }

  async function duplicate() {
    setBusy('dup');
    try {
      const res = await fetch('/api/email-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...form, name: `${form.name} (copy)` }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message || j.error);
      router.push(`/email-templates/${j.row.id}`);
    } catch (e) { setNotice({ tone: 'error', text: `Could not duplicate: ${e.message}` }); setBusy(''); }
  }

  async function del() {
    if (!window.confirm(`Delete the template "${form.name}"? This can't be undone.`)) return;
    setBusy('del');
    try {
      const res = await fetch(`/api/email-templates/${params.id}`, { method: 'DELETE' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.message || j.error);
      setDirty(false);
      router.push('/email-templates');
    } catch (e) { setNotice({ tone: 'error', text: `Could not delete: ${e.message}` }); setBusy(''); }
  }

  const fieldProps = (k) => ({
    ref: (el) => { refs.current[k] = el; },
    value: form[k] ?? '',
    onChange: set(k),
    onFocus: () => { if (FIELDS.includes(k)) lastField.current = k; },
    className: `${inputCls} ${errors[k] ? '!border-[#B23A3A]' : ''}`,
  });
  const Err = ({ k }) => (errors[k] ? <p className="mt-1 text-[11px]" style={{ color: T.danger }}>{errors[k]}</p> : null);
  const canDelete = !isNew && !meta.key && !meta.usedBy.length;

  return (
    <div className="space-y-5">
      <div>
        <Link href="/email-templates" className="text-[12px]" style={{ color: T.textSecondary }}>← Email templates</Link>
      </div>
      <PageHeader
        title={isNew ? 'New template' : (form.name || 'Template')}
        sub={isNew ? 'Write the email; the Casa Libre design is added automatically.' : [
          meta.key ? 'Built-in template' : 'Custom template',
          meta.usedBy.length ? `used by ${meta.usedBy.join(', ')}` : 'not used by an automation',
          meta.updated_at ? `last saved ${fmtDate(meta.updated_at, true)}` : null,
        ].filter(Boolean).join(' · ')}
      />

      {pending && <PendingMigration />}
      {notice && (notice.tone === 'success'
        ? <div className="text-xs px-4 py-3 rounded-[14px]" style={{ background: T.successSurface, color: T.success }}>{notice.text}</div>
        : <Banner>{notice.text}</Banner>)}

      {!pending && (loading ? (
        <p className="text-xs" style={{ color: T.textMuted }}>Loading…</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {/* Form */}
          <div className="p-5 space-y-4" style={CARD}>
            <div>
              <Label>Template name</Label>
              <input {...fieldProps('name')} placeholder="e.g. First listing — gift" />
              <Err k="name" />
            </div>
            <div>
              <Label hint="what people see in their inbox">Subject</Label>
              <input {...fieldProps('subject')} placeholder="{{name}}, tu propiedad está en la portada" />
              <Err k="subject" />
            </div>
            <div>
              <Label>Heading</Label>
              <input {...fieldProps('heading')} placeholder="Un regalo por publicar con nosotros" />
              <Err k="heading" />
            </div>
            <div>
              <Label hint="blank line = new paragraph · **bold** · [text](https://…)">Body</Label>
              <textarea {...fieldProps('body')} rows={9} className={`${fieldProps('body').className} leading-relaxed`} placeholder={'Hola {{name}},\n\nGracias por publicar…'} />
              <Err k="body" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label hint="optional">Button text</Label>
                <input {...fieldProps('button_label')} placeholder="Extender por {{price}}" />
                <Err k="button_label" />
              </div>
              <div>
                <Label hint="a link variable or https://">Button link</Label>
                <input {...fieldProps('button_url')} placeholder="{{extend_url}}" />
                <Err k="button_url" />
              </div>
            </div>

            <div>
              <Label hint="click to insert where your cursor is">Variables</Label>
              <div className="flex flex-wrap gap-1.5">
                {templateVars.map((v) => (
                  <button key={v.key} type="button" onClick={() => insertVar(v.key)} title={`${v.label} — e.g. ${v.sample}`}
                    className="text-[11px] font-mono px-2 py-1 rounded-full border transition-colors hover:bg-ink/5"
                    style={{ borderColor: T.borderLight, color: T.textBody }}>
                    {`{{${v.key}}}`}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-[13px]" style={{ color: T.textBody }}>
              <input type="checkbox" checked={form.is_active} onChange={set('is_active')} />
              Active — when off, automations skip this email
            </label>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button onClick={save} disabled={!!busy} className={btnPrimary}>{busy === 'save' ? 'Saving…' : isNew ? 'Create template' : 'Save'}</button>
              {!isNew && <button onClick={sendTest} disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }}>{busy === 'test' ? 'Sending…' : 'Send test'}</button>}
              {!isNew && <button onClick={duplicate} disabled={!!busy} className={btnSecondary} style={{ borderColor: T.borderLight, color: T.textBody }}>Duplicate</button>}
              {canDelete && <button onClick={del} disabled={!!busy} className={btnSecondary} style={{ borderColor: T.danger, color: T.danger }}>Delete</button>}
              {dirty && <span className="text-[11px]" style={{ color: T.textMuted }}>Unsaved changes</span>}
            </div>
            {!isNew && <p className="text-[11px]" style={{ color: T.textMuted }}>“Send test” uses sample data and only goes to the team test inbox, never to a real user.</p>}
          </div>

          {/* Preview */}
          <div className="overflow-hidden xl:sticky xl:top-4" style={CARD}>
            <div className="px-5 py-3 border-b" style={{ borderColor: T.borderLight, background: T.bgSurface }}>
              <div className="flex items-center justify-between gap-2">
                <div className="text-[10px] font-mono uppercase tracking-label" style={{ color: T.textMuted }}>
                  {english ? 'English preview · not saved, emails go out in Spanish' : 'Preview · sample data'}
                </div>
                <button type="button" onClick={() => { setEnglish((v) => !v); if (english) setTrState(''); }}
                  className="shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full border transition-colors"
                  style={english ? { background: T.primary, color: '#fff', borderColor: T.primary } : { background: T.bgWhite, color: T.textBody, borderColor: T.borderLight }}>
                  {english ? 'Back to Spanish' : 'Preview in English'}
                </button>
              </div>
              {english && trState === 'loading' && <div className="text-[11px] mt-1" style={{ color: T.textMuted }}>Translating…</div>}
              {english && trState === 'error' && <div className="text-[11px] mt-1" style={{ color: T.danger }}>The translation service didn’t answer. Showing Spanish.</div>}
              <div className="text-[13px] font-semibold mt-1 truncate" style={{ color: T.textPrimary }} title={preview.subject}>{preview.subject || <span style={{ color: T.textMuted }}>No subject yet</span>}</div>
            </div>
            <iframe title="Email preview" srcDoc={preview.html} className="w-full block" style={{ height: 640, border: 0, background: '#f9f4ee' }} sandbox="" />
          </div>
        </div>
      ))}
    </div>
  );
}
