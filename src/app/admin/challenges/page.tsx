import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import ChallengePoolClient from '@/components/admin/ChallengePoolClient';

export const dynamic = 'force-dynamic';

export default async function ChallengesPage() {
  const session = await requirePageRole(['admin'], '/admin/challenges');
  return (
    <OrganizerShell role={session.role} userId={session.userId} wide>
      <ChallengePoolClient />
    </OrganizerShell>
  );
}
