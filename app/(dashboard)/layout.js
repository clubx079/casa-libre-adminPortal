import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import AdminShell from '@/components/AdminShell';
import { listCountries } from '@/lib/control';
import { activeCountry, filterCountriesForSession } from '@/lib/adminCountry';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }) {
  const session = getSession();
  if (!session) redirect('/login');
  // Countries are filtered to the admin's access (superadmin sees all).
  const countries = filterCountriesForSession(await listCountries());
  const active = activeCountry();
  return (
    <AdminShell
      admin={{ email: session.email, name: session.name, role: session.role }}
      lang={getLang()}
      countries={countries}
      activeCountry={active}
    >
      {children}
    </AdminShell>
  );
}
