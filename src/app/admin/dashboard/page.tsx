import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import AdminDashboardClient from '@/components/admin/AdminDashboardClient';

export const dynamic = 'force-dynamic';

export default async function AdminDashboardPage() {
  const session = await requirePageRole(['admin'], '/admin/dashboard');
  return (
    <OrganizerShell role={session.role} wide>
      <AdminDashboardClient />
    </OrganizerShell>
  );
}
