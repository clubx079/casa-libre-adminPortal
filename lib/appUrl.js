// Public base URL for building links inside emails (invite / reset). Uses
// APP_PUBLIC_URL when set, else the production admin-portal host.
export function appBaseUrl() {
  const raw = process.env.APP_PUBLIC_URL || 'https://casa-libre-adminportal.apps.airosofts.com';
  return raw.replace(/\/+$/, '');
}
