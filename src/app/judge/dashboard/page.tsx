import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import JuryClient from '@/components/jury/JuryClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Jury' };

export default async function JudgeDashboardPage() {
  const session = await requirePageRole(['judge', 'admin'], '/judge/dashboard');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <JuryClient role={session.role} />
    </OrganizerShell>
  );
}
