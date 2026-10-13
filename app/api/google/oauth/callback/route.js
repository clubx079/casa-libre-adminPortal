// GET /api/google/oauth/callback — Google sends the admin back here after "Connect Google".
// Swaps the one-time code for tokens and shows the REFRESH TOKEN once, to be saved as the
// env var GOOGLE_ADS_REFRESH_TOKEN (it is not stored anywhere by the admin). Admin only.
import { getSession } from '@/lib/auth';
import { checkState, exchangeCode, SCOPES } from '@/lib/googleApi';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const page = (title, body) => new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font-family:system-ui,sans-serif;background:#f9f4ee;color:#111;margin:0;padding:32px 16px}main{max-width:720px;margin:0 auto;background:#fff;border:1px solid #e7e1d6;border-radius:14px;padding:24px}
h1{font-size:20px;margin:0 0 8px}p,li{font-size:14px;line-height:1.55;color:#3a3a37}code,textarea{font-family:ui-monospace,Menlo,monospace}textarea{width:100%;box-sizing:border-box;height:90px;font-size:13px;padding:10px;border:1px solid #ccc;border-radius:10px}
.ok{color:#0f6e56}.bad{color:#b23a3a}a{color:#111}button{margin-top:8px;padding:8px 14px;border-radius:999px;border:0;background:#111;color:#fff;font-weight:600;cursor:pointer}</style></head><body><main>${body}</main></body></html>`,
{ headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });

export async function GET(req) {
  if (!getSession()) return Response.redirect(new URL('/login', req.url), 302);
  const u = new URL(req.url);
  const back = '<p><a href="/marketing">← Back to Marketing</a></p>';
  if (u.searchParams.get('error')) return page('Not connected', `<h1 class="bad">Google sign-in was cancelled</h1><p>${esc(u.searchParams.get('error'))}</p>${back}`);
  const cookieState = req.headers.get('cookie')?.match(/(?:^|;\s*)cl_g_state=([^;]+)/)?.[1];
  if (!checkState(u.searchParams.get('state'), cookieState && decodeURIComponent(cookieState))) {
    return page('Not connected', `<h1 class="bad">This sign-in link expired</h1><p>Start again from the Marketing page.</p>${back}`);
  }
  let t;
  try { t = await exchangeCode(req, u.searchParams.get('code') || ''); }
  catch (e) { return page('Not connected', `<h1 class="bad">Google refused the sign-in</h1><p>${esc(e.message)}</p>${back}`); }

  const granted = String(t.scope || '').split(/\s+/).filter(Boolean);
  const missing = SCOPES.filter((s) => !granted.includes(s));
  const res = page('Google connected', `
    <h1 class="ok">Google connected</h1>
    ${t.refresh_token ? `<p>This is the <b>refresh token</b>. It is shown <b>only now</b> — save it as the admin setting
      <code>GOOGLE_ADS_REFRESH_TOKEN</code> (hosting environment + <code>.env.local</code>), then redeploy the admin.</p>
      <textarea readonly id="t">${esc(t.refresh_token)}</textarea>
      <button onclick="navigator.clipboard.writeText(document.getElementById('t').value);this.textContent='Copied'">Copy</button>`
      : `<p class="bad">Google did not return a refresh token. Remove the app's access at myaccount.google.com/permissions and connect again.</p>`}
    <p>Access granted:</p><ul>${granted.map((s) => `<li class="ok">${esc(s)}</li>`).join('')}${missing.map((s) => `<li class="bad">missing: ${esc(s)}</li>`).join('')}</ul>
    <p>Keep this token private — do not paste it in chats or emails.</p>${back}`);
  res.headers.append('Set-Cookie', 'cl_g_state=; Max-Age=0; Path=/');
  return res;
}
