import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { describeHealthProblem, getHealth } from '@/lib/ops/health';
import StudentLoginForm from '@/components/student/StudentLoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Student sign in' };

/** Already signed-in students go straight to their dashboard — no login flash. */
export default async function StudentLoginPage() {
  const session = await getSession({ touch: false }).catch(() => null);
  if (session?.role === 'student') redirect('/student/waiting');
  const setupIssue = describeHealthProblem(await getHealth());
  return <StudentLoginForm organizerSignedIn={Boolean(session)} setupIssue={setupIssue} />;
}
