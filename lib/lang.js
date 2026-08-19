// Server-side helper: read the current language from the cookie.
import 'server-only';
import { cookies } from 'next/headers';
import { LANG_COOKIE, normalizeLang } from './i18n';

export function getLang() {
  return normalizeLang(cookies().get(LANG_COOKIE)?.value);
}
