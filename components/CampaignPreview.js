'use client';
// Email & WhatsApp campaigns → click a campaign or one of its subjects → a pop-up with what was
// sent: the real email (HTML from Resend, in a sandboxed frame) or the WhatsApp template as it
// looks on the phone. /api/email-campaigns/preview.
import { useEffect, useRef, useState } from 'react';
import WhatsAppPreview from '@/components/campaigns/WhatsAppPreview';

const when = (iso) => { try { return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } };

function Modal({ campKey, subject, title, onClose }) {
  const [data, setData] = useState(null);
  const [lang, setLang] = useState('en');           // English first; "Show original" → Spanish
  const closeRef = useRef(null);
  useEffect(() => {
    let alive = true;
    const qs = new URLSearchParams({ key: campKey, ...(subject ? { subject } : {}) });
    fetch(`/api/email-campaigns/preview?${qs}`).then((r) => r.json())
      .then((j) => { if (alive) setData(j); })
      .catch(() => { if (alive) setData({ error: 'Could not load the preview. Try again.' }); });
    return () => { alive = false; };
  }, [campKey, subject]);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  const isWa = data?.kind === 'whatsapp';
  const hasEn = !!(data && (isWa ? data.lookEn : (data.htmlEn || data.textEn)));
  const en = lang === 'en' && hasEn;
  const subj = en && data?.subjectEn ? data.subjectEn : data?.subject;
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-ink/40 backdrop-blur-[2px]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="pv-title"
        className={`bg-white rounded-[16px] border border-ink/12 shadow-[0_20px_60px_rgba(0,0,0,.25)] w-full flex flex-col max-h-[92vh] ${isWa ? 'max-w-[460px]' : 'max-w-[760px]'}`}>
        <div className="px-5 py-3.5 border-b border-ink/10 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id="pv-title" className="text-[15px] font-bold text-ink truncate">{title}</h2>
            {data && !data.error ? (
              <p className="text-[12px] text-ink/55 mt-0.5 break-words">
                {isWa
                  ? <>WhatsApp template <b className="font-semibold text-ink/75">{data.name}</b>{data.look?.format ? `, ${data.look.format}` : ''}. The name is a sample; each person sees their own.</>
                  : <><b className="font-semibold text-ink/75">{subj}</b><br />Sent {when(data.sentAt)} to {data.to}{data.status ? `, ${data.status}` : ''}. This is the real email from Resend.</>}
              </p>
            ) : null}
            {data && !data.error ? (
              <div className="mt-2 flex items-center gap-2 flex-wrap">
                <div className="inline-flex rounded-full border border-ink/15 p-0.5" role="group" aria-label="Language">
                  {[['en', 'English'], ['es', 'Original (Spanish)']].map(([k, l]) => (
                    <button key={k} type="button" onClick={() => setLang(k)} aria-pressed={lang === k} disabled={k === 'en' && !hasEn}
                      className={`px-3 py-1 rounded-full text-[12px] font-medium disabled:opacity-40 ${lang === k && (k === 'es' || hasEn) ? 'bg-ink text-paper' : 'text-ink/65 hover:bg-ink/5'}`}>{l}</button>
                  ))}
                </div>
                {lang === 'en' && !hasEn ? <span className="text-[11.5px] text-ink/50">The translation didn&apos;t load, so this is the original.</span> : en ? <span className="text-[11.5px] text-ink/45">Translated for the team; it was sent in Spanish.</span> : null}
              </div>
            ) : null}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close preview"
            className="shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-ink/60 hover:bg-ink/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ink">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-[#F6F3EE]">
          {!data ? <p className="p-8 text-center text-[13px] text-ink/50">Loading the preview and its English translation…</p>
            : data.error ? <p className="p-8 text-center text-[13px] text-ink/60">{data.error}</p>
              : isWa ? (
                <div className="p-5">
                  {!data.relay ? <p className="mb-3 text-[12.5px] text-ink/60">The message text comes from Relay, which this copy of the admin can&apos;t reach. The live admin shows the full message.</p> : null}
                  <WhatsAppPreview look={en ? data.lookEn : data.look} chrome />
                </div>
              )
                : data.html ? <iframe key={en ? 'en' : 'es'} title={`Email: ${subj}`} sandbox="" srcDoc={en ? data.htmlEn : data.html} className="w-full h-[70vh] bg-white border-0 block" />
                  : <pre className="p-5 text-[13px] whitespace-pre-wrap text-ink/80">{(en ? data.textEn : data.text) || 'This email has no content saved.'}</pre>}
        </div>
      </div>
    </div>
  );
}

// A button that opens the preview. children = what to show; subject = one message (optional).
export default function PreviewButton({ campKey, subject = '', title, className = '', children }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className} title="See what was sent">{children}</button>
      {open ? <Modal campKey={campKey} subject={subject} title={title} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
