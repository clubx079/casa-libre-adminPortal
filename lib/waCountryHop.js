// WhatsApp buttons in other countries (Omar, Nov 22: same WhatsApp automations as Paraguay in
// every country). The Meta-approved templates have Paraguay's address fixed in their button
// (https://casa-libre.com.py/propiedad/…); we only fill the end. So a non-PY send adds
// `cl_c=<country>` to that end, and the Paraguay site sends the click on to the right country's
// site, same path and query (middleware.js). Pure — tests/waCountryHop.test.mjs.
export const HOP_PARAM = 'cl_c';
export const COUNTRY_ORIGIN = {
  bo: 'https://casa-libre.com.bo',
  uy: 'https://uy.casa-libre.com',
  ve: 'https://casa-libre.com.ve',
  sv: 'https://sv.casa-libre.com',
};

// the tag to add to a button's variable part for this country ('' in Paraguay / unknown)
export const hopTag = (country) => (COUNTRY_ORIGIN[String(country || '').toLowerCase()] ? `&${HOP_PARAM}=${String(country).toLowerCase()}` : '');

// url (a URL object of a request on the PY site) → the address to send it to, or null
export function hopTarget(url) {
  const cc = String(url?.searchParams?.get(HOP_PARAM) || '').toLowerCase();
  const origin = COUNTRY_ORIGIN[cc];
  if (!origin) return null;
  const params = new URLSearchParams(url.searchParams);
  params.delete(HOP_PARAM);
  const q = params.toString();
  return `${origin}${url.pathname}${q ? `?${q}` : ''}`;
}
