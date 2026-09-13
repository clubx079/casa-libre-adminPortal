import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import AdminShell from '@/components/AdminShell';
import { listCountries } from '@/lib/control';
import { activeCountry } from '@/lib/adminCountry';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }) {
  const session = getSession();
  if (!session) redirect('/login');
  const countries = await listCountries();
  const active = activeCountry();
  return (
    <AdminShell admin={{ email: session.email, name: session.name }} lang={getLang()} countries={countries} activeCountry={active}>
      {children}
    </AdminShell>
  );
}
