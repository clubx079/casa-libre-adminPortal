'use client';
// A WhatsApp template drawn the way it lands on the phone: header media (image / GIF / video),
// the body with WhatsApp formatting, the footer, the time and the button(s) under the bubble.
// chrome = the phone's top bar ("Casa-Libre · Business account") and the "Today" chip, as in
// Relay's template preview. look = templateLook(...) from lib/waTemplateLook.js.
import { waSegments, SAMPLE_NAME } from '@/lib/waTemplateLook';

const WA = { wall: '#EFE7DD', bubble: '#FFFFFF', ink: '#111B21', meta: '#667781', line: '#E9EDEF', link: '#027EB5', bar: '#0B5D4F', tick: '#53BDEB' };

function Body({ text }) {
  // the sample name is underlined, so it reads as "each person's own name"
  return waSegments(text).map((s, i) => {
    const style = { fontWeight: s.bold ? 600 : undefined, fontStyle: s.italic ? 'italic' : undefined, textDecoration: s.strike ? 'line-through' : undefined, fontFamily: s.mono ? 'ui-monospace, monospace' : undefined };
    const parts = s.text.split(new RegExp(`(\\b${SAMPLE_NAME}\\b)`));
    return (
      <span key={i} style={style}>
        {parts.map((p, k) => (p === SAMPLE_NAME
          ? <span key={k} title="Each person's first name" style={{ textDecoration: 'underline dotted', textUnderlineOffset: 3 }}>{p}</span>
          : p))}
      </span>
    );
  });
}

export function TemplateHeader({ h, maxW }) {
  return <div style={maxW ? { maxWidth: maxW } : undefined}><Header h={h} /></div>;
}

function Header({ h }) {
  const box = 'block w-full rounded-[6px] overflow-hidden';
  if (!h.src) {
    return (
      <div className={`${box} grid place-items-center text-[12px] font-medium`} style={{ aspectRatio: '1.91 / 1', background: '#D9DDE0', color: WA.meta }}>
        {h.type === 'video' ? 'Video' : h.type === 'gif' ? 'GIF' : h.type === 'document' ? 'Document' : 'Image'}
      </div>
    );
  }
  if (h.type === 'image') return <img src={h.src} alt="Template image" className={box} style={{ background: '#D9DDE0' }} loading="lazy" />;
  if (h.type === 'gif') {
    return (
      <div className="relative">
        <video src={h.src} className={box} autoPlay loop muted playsInline aria-label="Template GIF" style={{ background: '#D9DDE0' }} />
        <span className="absolute left-1.5 bottom-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(0,0,0,.55)', color: '#fff' }}>GIF</span>
      </div>
    );
  }
  return <video src={h.src} poster={h.poster || undefined} className={box} controls preload="none" playsInline aria-label="Template video" style={{ background: '#000' }} />;
}

export default function WhatsAppPreview({ look, time = '10:42', compact = false, chrome = false }) {
  if (!look) return null;
  const pad = compact ? 'p-2.5' : 'p-3.5';
  return (
    <div className="rounded-[12px] overflow-hidden" style={{ background: WA.wall }} data-testid="wa-preview">
      {chrome && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5" style={{ background: WA.bar }}>
          <span className="w-8 h-8 rounded-full grid place-items-center text-[13px] font-bold" style={{ background: 'rgba(255,255,255,.18)', color: '#fff' }}>C</span>
          <div className="leading-tight">
            <div className="text-[14px] font-semibold" style={{ color: '#fff' }}>Casa-Libre</div>
            <div className="text-[11.5px]" style={{ color: 'rgba(255,255,255,.75)' }}>Business account</div>
          </div>
        </div>
      )}
      <div className={pad}>
        {chrome && <div className="flex justify-center mb-2.5"><span className="text-[11.5px] px-2.5 py-0.5 rounded-md shadow-[0_1px_0.5px_rgba(11,20,26,.13)]" style={{ background: '#fff', color: WA.meta }}>Today</span></div>}
        <div className="max-w-[300px] mx-auto">
          <div className="relative rounded-[8px] rounded-tl-none shadow-[0_1px_0.5px_rgba(11,20,26,.13)]" style={{ background: WA.bubble }}>
            {/* the bubble's tail */}
            <svg viewBox="0 0 8 13" width="8" height="13" className="absolute -left-2 top-0" aria-hidden="true"><path d="M8 0H1.5C.4 0 0 1.4.9 2.1L8 8.5z" fill={WA.bubble} /></svg>
            <div className="p-[3px]">
              {look.header && <Header h={look.header} />}
            </div>
            <div className="px-2.5 pb-1.5 pt-0.5">
              <p className="text-[13.5px] leading-[19px] whitespace-pre-wrap break-words" style={{ color: WA.ink }} data-testid="wa-preview-body">{look.body ? <Body text={look.body} /> : <span style={{ color: WA.meta }}>The text loads from Relay…</span>}</p>
              {look.footer && <p className="text-[12.5px] mt-1" style={{ color: WA.meta }}>{look.footer}</p>}
              <p className="text-[11px] text-right -mt-0.5 flex items-center justify-end gap-1" style={{ color: WA.meta }}>
                {time}
                {chrome && <svg viewBox="0 0 16 11" width="16" height="11" aria-hidden="true"><path d="M11.1.6 4.8 7 2.2 4.4l-1 1L4.8 9l7.3-7.4zM14.8.6 8.5 7l-.6-.6-1 1L8.5 9l7.3-7.4z" fill={WA.tick} /></svg>}
              </p>
            </div>
          </div>
          {/* the buttons, each its own box under the bubble (as WhatsApp shows them) */}
          {look.buttons.map((b, i) => {
            const inner = <>
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" /><path d="M15 3h6v6" /><path d="M10 14 21 3" /></svg>
              {b}
            </>;
            const cls = 'mt-[3px] flex items-center justify-center gap-1.5 py-2.5 text-[14px] font-medium rounded-[8px] shadow-[0_1px_0.5px_rgba(11,20,26,.13)]';
            // the button opens where it lands (without the batch's tracking: no click is counted)
            return look.url
              ? <a key={i} href={look.url} target="_blank" rel="noopener noreferrer" className={`${cls} hover:brightness-[.97]`} style={{ background: WA.bubble, color: WA.link }} title={look.url} data-testid="wa-preview-button">{inner}</a>
              : <div key={i} className={cls} style={{ background: WA.bubble, color: WA.link }} data-testid="wa-preview-button">{inner}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
