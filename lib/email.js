// Transactional email via Resend. Notifies the admin team about scraper registry activity. Server-only.
import 'server-only';
import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.RESEND_FROM || 'Casa Libre <onboarding@resend.dev>';

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('email_timeout')), ms))]);

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function scraperAddedHtml({ name, url, description }) {
  const safeName = esc(name);
  const safeUrl = esc(url);
  const safeDescription = description ? esc(description) : '';
  return `<!doctype html><html><body style="margin:0;background:#f9f4ee;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f4ee;padding:32px 0">
    <tr><td align="center">
      <table width="440" cellpadding="0" cellspacing="0" style="background:#fff;border:1.5px solid rgba(17,17,17,.12);border-radius:20px;overflow:hidden">
        <tr><td style="padding:28px 32px 8px">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.03em">casa-libre<span style="font-style:italic">.py</span></div>
        </td></tr>
        <tr><td style="padding:8px 32px 0">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em">Nuevo sitio propuesto para scraping</div>
          <div style="font-size:14px;color:rgba(17,17,17,.55);margin-top:6px">Se agregó una nueva fuente al panel de scraping.</div>
        </td></tr>
        <tr><td style="padding:20px 32px 0">
          <div style="font-size:12px;color:rgba(17,17,17,.45);text-transform:uppercase;letter-spacing:.06em">Nombre</div>
          <div style="font-size:16px;font-weight:600;margin-top:2px">${safeName}</div>
        </td></tr>
        <tr><td style="padding:16px 32px 0">
          <div style="font-size:12px;color:rgba(17,17,17,.45);text-transform:uppercase;letter-spacing:.06em">URL</div>
          <div style="font-size:14px;margin-top:2px"><a href="${safeUrl}" style="color:#111;text-decoration:underline">${safeUrl}</a></div>
        </td></tr>
        ${
          safeDescription
            ? `<tr><td style="padding:16px 32px 0">
          <div style="font-size:12px;color:rgba(17,17,17,.45);text-transform:uppercase;letter-spacing:.06em">Nota</div>
          <div style="font-size:14px;margin-top:2px">${safeDescription}</div>
        </td></tr>`
            : ''
        }
        <tr><td style="padding:20px 32px 28px">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:rgba(17,17,17,.45)">Estado: Pendiente — revisá y activá desde el panel.</div>
        </td></tr>
      </table>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(17,17,17,.4);margin-top:16px">Casa Libre — Paraguay</div>
    </td></tr>
  </table></body></html>`;
}

// Shared branded shell for admin-account emails (invite + reset).
function adminEmailHtml({ heading, intro, cta, link, footNote }) {
  return `<!doctype html><html><body style="margin:0;background:#f9f4ee;font-family:'Space Grotesk',Helvetica,Arial,sans-serif;color:#111">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9f4ee;padding:32px 0">
    <tr><td align="center">
      <table width="440" cellpadding="0" cellspacing="0" style="background:#fff;border:1.5px solid rgba(17,17,17,.12);border-radius:20px;overflow:hidden">
        <tr><td style="padding:28px 32px 4px">
          <div style="font-size:22px;font-weight:700;letter-spacing:-0.03em">Casa Libre <span style="font-style:italic">Admin</span></div>
        </td></tr>
        <tr><td style="padding:12px 32px 0">
          <div style="font-size:20px;font-weight:700;letter-spacing:-0.02em">${esc(heading)}</div>
          <div style="font-size:14px;color:rgba(17,17,17,.6);margin-top:8px;line-height:1.5">${esc(intro)}</div>
        </td></tr>
        <tr><td style="padding:24px 32px 4px">
          <a href="${esc(link)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:12px 22px;border-radius:999px">${esc(cta)}</a>
        </td></tr>
        <tr><td style="padding:16px 32px 0">
          <div style="font-size:12px;color:rgba(17,17,17,.45)">Or paste this link into your browser:</div>
          <div style="font-size:12px;margin-top:2px;word-break:break-all"><a href="${esc(link)}" style="color:#111">${esc(link)}</a></div>
        </td></tr>
        <tr><td style="padding:20px 32px 28px">
          <div style="font-family:'IBM Plex Mono',monospace;font-size:12px;color:rgba(17,17,17,.45)">${esc(footNote)}</div>
        </td></tr>
      </table>
      <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;color:rgba(17,17,17,.4);margin-top:16px">Casa Libre — Admin Portal</div>
    </td></tr>
  </table></body></html>`;
}

// Send an invitation to a newly-added admin. Never throws → { ok } | { ok:false, error }.
export async function sendAdminInviteEmail(to, { name, link }) {
  if (!resend) return { ok: false, error: 'email_not_configured' };
  const hi = name ? `Hi ${name}, ` : '';
  try {
    const { error } = await withTimeout(
      resend.emails.send({
        from: FROM,
        to,
        subject: 'You have been invited to the Casa Libre Admin Portal',
        html: adminEmailHtml({
          heading: 'You are invited',
          intro: `${hi}you have been invited to the Casa Libre Admin Portal. Click below to set your password and activate your account.`,
          cta: 'Set your password',
          link,
          footNote: 'This invitation link expires in 7 days.',
        }),
        text: `${hi}you have been invited to the Casa Libre Admin Portal.\nSet your password to activate your account:\n${link}\n\nThis invitation link expires in 7 days.`,
      }),
      15000,
    );
    if (error) return { ok: false, error: error.message || 'send_failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'send_failed' };
  }
}

// Send a password-reset link to an admin. Never throws → { ok } | { ok:false, error }.
export async function sendAdminResetEmail(to, { link }) {
  if (!resend) return { ok: false, error: 'email_not_configured' };
  try {
    const { error } = await withTimeout(
      resend.emails.send({
        from: FROM,
        to,
        subject: 'Reset your Casa Libre Admin password',
        html: adminEmailHtml({
          heading: 'Reset your password',
          intro: 'We received a request to reset your Casa Libre Admin password. Click below to choose a new one. If you did not request this, you can ignore this email.',
          cta: 'Reset password',
          link,
          footNote: 'This reset link expires in 1 hour.',
        }),
        text: `Reset your Casa Libre Admin password:\n${link}\n\nThis reset link expires in 1 hour. If you did not request this, ignore this email.`,
      }),
      15000,
    );
    if (error) return { ok: false, error: error.message || 'send_failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'send_failed' };
  }
}

// Notify the admin team that a new scraper source was proposed. Returns { ok } or { ok:false, error }. Never throws.
export async function sendScraperAddedEmail({ name, url, description }) {
  if (!resend) return { ok: false, error: 'email_not_configured' };
  const to = process.env.ADMIN_NOTIFY_EMAIL || 'omar@airosofts.com';
  try {
    const { error } = await withTimeout(
      resend.emails.send({
        from: FROM,
        to,
        subject: `Nuevo scraper propuesto: ${name}`,
        html: scraperAddedHtml({ name, url, description }),
        text: `Nuevo sitio propuesto para scraping.\nNombre: ${name}\nURL: ${url}\nNota: ${description || '-'}\nEstado: Pendiente.`,
      }),
      15000
    );
    if (error) return { ok: false, error: error.message || 'send_failed' };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'send_failed' };
  }
}
