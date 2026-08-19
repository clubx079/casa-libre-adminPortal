import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import AdminShell from '@/components/AdminShell';

export const dynamic = 'force-dynamic';

export default function DashboardLayout({ children }) {
  const session = getSession();
  if (!session) redirect('/login');
  return (
    <AdminShell admin={{ email: session.email, name: session.name }} lang={getLang()}>
      {children}
    </AdminShell>
  );
}
