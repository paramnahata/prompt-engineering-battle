import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import StudentLoginForm from '@/components/student/StudentLoginForm';

export const dynamic = 'force-dynamic';

/** Already signed-in students go straight to their arena — no login flash. */
export default async function StudentLoginPage() {
  const session = await getSession({ touch: false });
  if (session?.role === 'student') redirect('/student/waiting');
  return <StudentLoginForm organizerSignedIn={Boolean(session)} />;
}
