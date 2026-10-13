import { requirePageRole } from '@/lib/auth/session';
import WaitingRoom from '@/components/student/WaitingRoom';

export const dynamic = 'force-dynamic';

export default async function WaitingPage() {
  const session = await requirePageRole(['student'], '/student/waiting');
  return <WaitingRoom entryNumber={session.entryNumber} />;
}
