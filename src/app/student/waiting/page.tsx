import { redirect } from 'next/navigation';
import { requirePageRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { feedbackStatus } from '@/lib/feedback';
import StudentHome from '@/components/student/StudentHome';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My dashboard' };

export default async function StudentHomePage() {
  const session = await requirePageRole(['student'], '/student/waiting');
  const fb = await feedbackStatus(supabaseAdmin(), session.userId).catch(() => null);
  if (fb?.required) redirect('/student/feedback');
  return <StudentHome entryNumber={session.entryNumber} />;
}
