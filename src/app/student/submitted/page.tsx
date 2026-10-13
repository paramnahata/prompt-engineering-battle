import { requirePageRole } from '@/lib/auth/session';
import SubmittedScreen from '@/components/student/SubmittedScreen';

export const dynamic = 'force-dynamic';

export default async function SubmittedPage({ searchParams }: { searchParams: { ref?: string } }) {
  const session = await requirePageRole(['student'], '/student/submitted');
  const ref = typeof searchParams.ref === 'string' && /^[A-Z0-9-]{1,40}$/.test(searchParams.ref) ? searchParams.ref : null;
  return <SubmittedScreen submissionRef={ref} entryNumber={session.entryNumber} />;
}
