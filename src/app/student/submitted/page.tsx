import { redirect } from 'next/navigation';
import { requirePageRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { feedbackStatus } from '@/lib/feedback';
import SubmittedScreen from '@/components/student/SubmittedScreen';

export const dynamic = 'force-dynamic';

export default async function SubmittedPage({ searchParams }: { searchParams: { ref?: string } }) {
  const session = await requirePageRole(['student'], '/student/submitted');
  const ref = typeof searchParams.ref === 'string' && /^[A-Z0-9-]{1,40}$/.test(searchParams.ref) ? searchParams.ref : null;
  // Round 1 feedback is required before the confirmation / dashboard.
  const fb = await feedbackStatus(supabaseAdmin(), session.userId).catch(() => null);
  if (fb?.required) redirect(`/student/feedback${ref ? `?ref=${ref}` : ''}`);
  return <SubmittedScreen submissionRef={ref} entryNumber={session.entryNumber} />;
}
