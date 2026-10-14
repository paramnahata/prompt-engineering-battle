import { requirePageRole } from '@/lib/auth/session';
import StudentResults from '@/components/student/StudentResults';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Results' };

export default async function ResultsPage() {
  const session = await requirePageRole(['student'], '/student/results');
  return <StudentResults entryNumber={session.entryNumber} />;
}
