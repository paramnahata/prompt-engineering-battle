import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import AdminDashboardClient from '@/components/admin/AdminDashboardClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Round 1' };

export default async function Round1Page() {
  const session = await requirePageRole(['admin'], '/admin/round1');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <AdminDashboardClient />
    </OrganizerShell>
  );
}
