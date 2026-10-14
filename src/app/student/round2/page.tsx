import { requirePageRole } from '@/lib/auth/session';
import Round2Arena from '@/components/student/Round2Arena';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Round 2' };

export default async function Round2Page() {
  const session = await requirePageRole(['student'], '/student/round2');
  return <Round2Arena entryNumber={session.entryNumber} />;
}
