import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import UserManagementClient from '@/components/admin/UserManagementClient';

export const dynamic = 'force-dynamic';

export default async function UsersPage() {
  const session = await requirePageRole(['admin'], '/admin/users');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <UserManagementClient />
    </OrganizerShell>
  );
}
