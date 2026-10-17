import { redirect } from 'next/navigation';
import { requirePageRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { feedbackStatus } from '@/lib/feedback';
import FeedbackForm from '@/components/student/FeedbackForm';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Round 1 feedback' };

/** Required once a team's Round 1 answers are locked; the dashboard opens after it. */
export default async function FeedbackPage({ searchParams }: { searchParams: { ref?: string } }) {
  const session = await requirePageRole(['student'], '/student/feedback');
  const ref = typeof searchParams.ref === 'string' && /^[A-Z0-9-]{1,40}$/.test(searchParams.ref) ? searchParams.ref : null;
  const status = await feedbackStatus(supabaseAdmin(), session.userId).catch(() => ({ required: false, given: false, available: false }));
  if (!status.required) redirect(status.given || !status.available ? `/student/submitted${ref ? `?ref=${ref}` : ''}` : '/student/waiting');
  return <FeedbackForm entryNumber={session.entryNumber} submissionRef={ref} />;
}
