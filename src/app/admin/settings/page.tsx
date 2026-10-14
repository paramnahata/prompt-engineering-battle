import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import SettingsClient from '@/components/admin/SettingsClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Settings & health' };

export default async function Page() {
  const session = await requirePageRole(['admin'], '/admin/settings');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <SettingsClient />
    </OrganizerShell>
  );
}
