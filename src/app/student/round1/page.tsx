import { requirePageRole } from '@/lib/auth/session';
import Round1Arena from '@/components/student/Round1Arena';

export const dynamic = 'force-dynamic';

export default async function Round1Page() {
  const session = await requirePageRole(['student'], '/student/round1');
  return <Round1Arena entryNumber={session.entryNumber} />;
}
