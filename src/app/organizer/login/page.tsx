import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import OrganizerLoginForm from '@/components/auth/OrganizerLoginForm';

export const dynamic = 'force-dynamic';

export default function OrganizerLoginPage() {
  const session = getSession();
  if (session) {
    if (session.role === 'admin') redirect('/admin/dashboard');
    if (session.role === 'volunteer') redirect('/admin/attendance');
    if (session.role === 'judge') redirect('/judge/dashboard');
    if (session.role === 'student') redirect('/student/waiting');
  }
  return <OrganizerLoginForm />;
}
