import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import FeedbackClient from '@/components/admin/FeedbackClient';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Feedback' };

export default async function Page() {
  const session = await requirePageRole(['admin'], '/admin/feedback');
  return (
    <OrganizerShell role={session.role} userId={session.userId}>
      <FeedbackClient />
    </OrganizerShell>
  );
}
