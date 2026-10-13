import { redirect } from 'next/navigation';
import { getSession, homeForRole } from '@/lib/auth/session';
import { safeNextPath } from '@/lib/http';
import OrganizerLoginForm from '@/components/auth/OrganizerLoginForm';

export const dynamic = 'force-dynamic';

export default async function OrganizerLoginPage({ searchParams }: { searchParams: { next?: string } }) {
  const session = await getSession({ touch: false });
  if (session) {
    if (session.role === 'student') redirect(homeForRole('student'));
    redirect(safeNextPath(searchParams.next, homeForRole(session.role)));
  }
  return <OrganizerLoginForm next={safeNextPath(searchParams.next, '/organizer/hub')} />;
}
