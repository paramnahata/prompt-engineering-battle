import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import ResultsClient from '@/components/admin/ResultsClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Results' };

export default async function Page() {
  const session = await requirePageRole(['admin'], '/admin/results');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <ResultsClient />
    </OrganizerShell>
  );
}
