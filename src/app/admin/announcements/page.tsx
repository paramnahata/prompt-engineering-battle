import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import AnnouncementsClient from '@/components/admin/AnnouncementsClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Announcements' };

export default async function Page() {
  const session = await requirePageRole(['admin'], '/admin/announcements');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <AnnouncementsClient />
    </OrganizerShell>
  );
}
