import { requirePageRole } from '@/lib/auth/session';
import StudentHome from '@/components/student/StudentHome';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My dashboard' };

export default async function StudentHomePage() {
  const session = await requirePageRole(['student'], '/student/waiting');
  return <StudentHome entryNumber={session.entryNumber} />;
}
