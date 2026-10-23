'use client';
// What a drafted Admin Manager email will look like in the person's inbox — the same frame
// as lib/emailTemplateRender.js (cream page, white card, casa-libre wordmark, black pill
// button). Body: blank-line paragraphs, **bold** and [text](url), rendered as React (no HTML).

const INLINE = /(\*\*[^*]+\*\*|\[[^\]]+\]\([^)\s]+\))/g;

function Inline({ text }) {
  return String(text).split(INLINE).map((part, i) => {
    const bold = part.match(/^\*\*([^*]+)\*\*$/);
    if (bold) return <strong key={i} style={{ color: '#111' }}>{bold[1]}</strong>;
    const link = part.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    if (link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer" style={{ color: '#111', textDecoration: 'underline' }}>{link[1]}</a>;
    return part.split('\n').map((line, k, all) => <span key={`${i}-${k}`}>{line}{k < all.length - 1 ? <br /> : null}</span>);
  });
}

export default function EmailPreview({ subject, heading, body, buttonLabel, buttonUrl, tld = '.py', from }) {
  const paragraphs = String(body || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return (
    <div className="rounded-[12px] overflow-hidden" style={{ border: '1px solid #E7E1D6' }}>
      <div className="px-4 py-2.5 text-[12px] space-y-0.5" style={{ background: '#FFFFFF', borderBottom: '1px solid #E7E1D6' }}>
        {from ? <p style={{ color: '#9C978C' }}>From <span style={{ color: '#3A3A37' }}>{from}</span></p> : null}
        <p className="text-[13px] font-semibold" style={{ color: '#111' }}>{subject || 'No subject'}</p>
      </div>
      <div className="px-3 py-5 sm:px-6" style={{ background: '#F9F4EE' }}>
        <div className="mx-auto max-w-[460px] rounded-[16px] bg-white" style={{ border: '1.5px solid rgba(17,17,17,.12)' }}>
          <div className="px-6 pt-5 pb-1 text-[19px] font-bold" style={{ letterSpacing: '-0.03em', color: '#111' }}>
            casa-libre<span className="italic">{tld}</span>
          </div>
          {heading ? <p className="px-6 pt-2 pb-2 text-[17px] font-bold leading-snug" style={{ letterSpacing: '-0.02em', color: '#111' }}>{heading}</p> : null}
          <div className="px-6 pt-1">
            {paragraphs.map((p, i) => (
              <p key={i} className="mb-3 text-[13.5px] leading-relaxed" style={{ color: 'rgba(17,17,17,.75)' }}><Inline text={p} /></p>
            ))}
          </div>
          <div className="px-6 pb-6 pt-1">
            {buttonLabel && buttonUrl ? (
              <a href={buttonUrl} target="_blank" rel="noreferrer" className="inline-block rounded-full px-5 py-2.5 text-[13px] font-semibold" style={{ background: '#111', color: '#F9F4EE' }}>{buttonLabel}</a>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
