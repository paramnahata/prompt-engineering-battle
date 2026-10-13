import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import EntryDetailClient from '@/components/admin/EntryDetailClient';

export const dynamic = 'force-dynamic';

export default async function EntryDetailPage({ params }: { params: { entryId: string } }) {
  const session = await requirePageRole(['admin'], '/admin/entries');
  return (
    <OrganizerShell role={session.role} back={{ href: '/admin/entries', label: 'Entries' }}>
      <EntryDetailClient entryId={params.entryId} />
    </OrganizerShell>
  );
}
