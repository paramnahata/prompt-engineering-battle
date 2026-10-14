import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import RegistrationDeskClient from '@/components/admin/RegistrationDeskClient';

export const dynamic = 'force-dynamic';

export default async function RegistrationDeskPage() {
  const session = await requirePageRole(['admin', 'volunteer'], '/admin/attendance');
  return (
    <OrganizerShell role={session.role} userId={session.userId} wide>
      <RegistrationDeskClient canImport={session.role === 'admin'} />
    </OrganizerShell>
  );
}
