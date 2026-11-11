import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getSession } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import AdminShell from '@/components/AdminShell';
import { listCountries, currentAccess } from '@/lib/control';
import { activeCountry, filterCountriesForSession } from '@/lib/adminCountry';
import { sessionPages, normalizeAccess, canOpenPath, homeFor } from '@/lib/adminPages';

export const dynamic = 'force-dynamic';

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export default async function DashboardLayout({ children }) {
  const session = getSession();
  if (!session) redirect('/login');

  // The cookie can be days old: if a Super Admin changed this member's role, countries or page
  // access since (or removed them), re-issue the session first (/api/auth/refresh). Cached 30 s.
  const path = headers().get('x-pathname') || '/';
  if (session.id) {
    const now = await currentAccess(session.id);
    if (now && (now.removed || !now.is_active || now.role !== session.role
      || !same(now.allowed_countries, session.allowed_countries)
      || !same(now.role === 'superadmin' ? null : now.page_access, normalizeAccess(session.access)))) {
      redirect(`/api/auth/refresh?next=${encodeURIComponent(path)}`);
    }
  }
  if (!canOpenPath(session, path)) redirect(homeFor(session));

  // Countries are filtered to the admin's access (superadmin sees all).
  const countries = filterCountriesForSession(await listCountries());
  const active = activeCountry();
  return (
    <AdminShell
      admin={{ email: session.email, name: session.name, role: session.role }}
      pages={sessionPages(session)}
      lang={getLang()}
      countries={countries}
      activeCountry={active}
    >
      {children}
    </AdminShell>
  );
}
