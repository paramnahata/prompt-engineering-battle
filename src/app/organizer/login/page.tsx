import { redirect } from 'next/navigation';
import { getSession, homeForRole } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/http';
import { describeHealthProblem, getHealth } from '@/lib/ops/health';
import OrganizerLoginForm from '@/components/auth/OrganizerLoginForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Organizer sign in' };

export default async function OrganizerLoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const session = await getSession({ touch: false }).catch(() => null);
  if (session) {
    if (session.role === 'student') redirect(homeForRole('student'));
    redirect(safeNextPath(searchParams.next, homeForRole(session.role)));
  }
  const setupIssue = describeHealthProblem(await getHealth());
  return <OrganizerLoginForm next={safeNextPath(searchParams.next, '')} setupIssue={setupIssue} />;
}
