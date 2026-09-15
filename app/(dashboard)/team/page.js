import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { listAdmins, listCountries } from '@/lib/control';
import TeamClient from '@/components/TeamClient';

export const dynamic = 'force-dynamic';

// The Team screen. Super Admins get full member management; every other admin
// only gets the "Account / change password" section. Member data + APIs are
// gated to superadmin server-side (here and in /api/team/*), never just hidden.
export default async function TeamPage() {
  const session = getSession();
  if (!session) redirect('/login');
  const isSuper = session.role === 'superadmin';

  let admins = [];
  let countries = [];
  if (isSuper) {
    [admins, countries] = await Promise.all([
      listAdmins().catch(() => []),
      listCountries().catch(() => []),
    ]);
  }

  return (
    <TeamClient
      isSuper={isSuper}
      me={{ id: session.id ?? null, email: session.email, name: session.name, role: session.role }}
      initialAdmins={admins}
      countries={countries}
      canChangePassword={!!session.id}
    />
  );
}
