'use client';
// Automations → "Preview" next to "Edit" on every template (Omar, Nov 23): a pop-up over the
// Automations page with the template as people get it — the email in the Casa Libre frame with
// sample data, or the WhatsApp template as it looks on the phone. English first (the emails go
// out in Spanish), "Show original" for the Spanish.
//   <EmailPreviewButton templateId />   email_templates row (GET /api/email-templates/<id>)
//   <WaPreviewButton name />            Relay template (GET /api/email-campaigns/preview, WhatsApp branch)
import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderTemplate, sampleVars } from '@/lib/emailTemplateRender';
import { BADGE_APPLE_PNG, BADGE_PLAY_PNG } from '@/lib/emailBadges';
import { countryFrame } from '@/lib/automationAdmin';
import { fixedEnglish, TEMPLATE_FIELDS } from '@/lib/templateEnglish';
import WhatsAppPreview from '@/components/campaigns/WhatsAppPreview';
import { T } from '@/components/automations/ui';

const linkCls = 'text-[11px] underline underline-offset-2';

function Shell({ title, english, setEnglish, canToggle, onClose, children }) {
  const closeRef = useRef(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full max-w-[680px] max-h-[90vh] flex flex-col rounded-[18px] bg-white shadow-xl overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3.5 border-b" style={{ borderColor: T.borderLight }}>
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-bold truncate" style={{ color: T.textPrimary }}>{title}</div>
            <div className="text-[11px]" style={{ color: T.textMuted }}>{english ? 'English preview · people get it in Spanish' : 'Original (as people get it)'}</div>
          </div>
          {canToggle ? (
            <button type="button" onClick={() => setEnglish(!english)} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ background: T.textPrimary, color: '#fff' }} data-testid="tpl-preview-toggle">
              {english ? 'Show original' : 'Show English'}
            </button>
          ) : null}
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className="w-8 h-8 rounded-full border flex items-center justify-center text-[16px]" style={{ borderColor: T.borderLight, color: T.textBody }}>×</button>
        </div>
        <div className="overflow-y-auto" style={{ background: '#f9f4ee' }}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}

function EmailModal({ templateId, onClose }) {
  const [row, setRow] = useState(null);
  const [country, setCountry] = useState('py');
  const [err, setErr] = useState('');
  const [english, setEnglish] = useState(true);
  const [tr, setTr] = useState(null);         // machine translation of the fields without a fixed English
  useEffect(() => {
    let alive = true;
    fetch(`/api/email-templates/${encodeURIComponent(templateId)}`, { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (!alive) return; if (j.row) { setRow(j.row); if (j.country) setCountry(j.country); } else setErr('Could not load this template.'); })
      .catch(() => { if (alive) setErr('Could not load this template.'); });
    return () => { alive = false; };
  }, [templateId]);
  const fixed = useMemo(() => (row ? fixedEnglish(row) : {}), [row]);
  const needsTr = !!row && TEMPLATE_FIELDS.some((f) => fixed[f] == null && row[f]);
  useEffect(() => {
    if (!row || !needsTr || !english || tr) return;
    let alive = true;
    fetch('/api/email-templates/translate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f, row[f] || '']))) })
      .then((r) => r.json()).then((j) => { if (alive && j.ok) setTr(j); }).catch(() => {});
    return () => { alive = false; };
  }, [row, needsTr, english, tr]);
  const shown = row && english
    ? { ...row, ...Object.fromEntries(TEMPLATE_FIELDS.map((f) => [f, fixed[f] ?? tr?.[f] ?? null]).filter(([, v]) => v != null)) }
    : row;
  const html = useMemo(() => (shown ? renderTemplate(shown, sampleVars, countryFrame(country, {
    appleSrc: `data:image/png;base64,${BADGE_APPLE_PNG}`,
    playSrc: `data:image/png;base64,${BADGE_PLAY_PNG}`,
  })).html : ''), [shown, country]);
  const waiting = english && needsTr && !tr;
  return (
    <Shell title={row ? `${row.name}` : 'Email template'} english={english} setEnglish={setEnglish} canToggle={!!row} onClose={onClose}>
      {err ? <p className="p-5 text-[13px]" style={{ color: T.danger }}>{err}</p> : !row ? <p className="p-5 text-[13px]" style={{ color: T.textMuted }}>Loading…</p> : (
        <>
          <div className="px-5 py-3 text-[12.5px] bg-white border-b" style={{ borderColor: T.borderLight, color: T.textBody }}>
            <b style={{ color: T.textPrimary }}>Subject: </b>{shown.subject}{waiting ? <span style={{ color: T.textMuted }}> · translating…</span> : null}
          </div>
          <iframe title="Email preview" srcDoc={html} className="w-full block" style={{ height: 620, border: 0, background: '#f9f4ee' }} sandbox="" />
        </>
      )}
    </Shell>
  );
}

function WaModal({ name, onClose }) {
  const [d, setD] = useState(null);
  const [english, setEnglish] = useState(true);
  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ key: 'automation', subject: `WhatsApp template: ${name}` });
    fetch(`/api/email-campaigns/preview?${qs}`, { cache: 'no-store' }).then((r) => r.json())
      .then((j) => { if (alive) setD(j); }).catch(() => { if (alive) setD({ error: 'Could not load this template.' }); });
    return () => { alive = false; };
  }, [name]);
  const look = d && (english && d.lookEn ? d.lookEn : d.look);
  return (
    <Shell title={`WhatsApp · ${name}`} english={english && !!d?.lookEn} setEnglish={setEnglish} canToggle={!!d?.lookEn} onClose={onClose}>
      {!d ? <p className="p-5 text-[13px]" style={{ color: T.textMuted }}>Loading…</p>
        : d.error ? <p className="p-5 text-[13px]" style={{ color: T.danger }}>{d.error}</p>
        : <div className="p-5 flex justify-center"><WhatsAppPreview look={look} chrome /></div>}
    </Shell>
  );
}

export function EmailPreviewButton({ templateId }) {
  const [open, setOpen] = useState(false);
  if (!templateId) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={linkCls} style={{ color: T.textSecondary }} data-testid="tpl-preview">Preview</button>
      {open ? <EmailModal templateId={templateId} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

export function WaPreviewButton({ name }) {
  const [open, setOpen] = useState(false);
  if (!name) return null;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={linkCls} style={{ color: T.textSecondary }} data-testid="wa-preview">Preview</button>
      {open ? <WaModal name={name} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
