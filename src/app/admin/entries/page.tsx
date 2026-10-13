import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import EntriesListClient from '@/components/admin/EntriesListClient';

export const dynamic = 'force-dynamic';

export default async function EntriesPage() {
  const session = await requirePageRole(['admin'], '/admin/entries');
  return (
    <OrganizerShell role={session.role} back={{ href: '/admin/dashboard', label: 'Dashboard' }}>
      <EntriesListClient />
    </OrganizerShell>
  );
}
