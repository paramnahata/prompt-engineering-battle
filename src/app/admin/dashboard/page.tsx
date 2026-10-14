import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import OverviewClient from '@/components/admin/OverviewClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

export default async function AdminDashboardPage() {
  const session = await requirePageRole(['admin'], '/admin/dashboard');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <OverviewClient />
    </OrganizerShell>
  );
}
