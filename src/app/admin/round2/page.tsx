import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import Round2Client from '@/components/admin/Round2Client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Round 2' };

export default async function Page() {
  const session = await requirePageRole(['admin'], '/admin/round2');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <Round2Client />
    </OrganizerShell>
  );
}
