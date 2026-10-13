import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';

export const dynamic = 'force-dynamic';

export default async function JudgeDashboardPage() {
  const session = await requirePageRole(['judge'], '/judge/dashboard');
  return (
    <OrganizerShell role={session.role}>
      <h1 className="mb-2 text-2xl font-semibold">Judge Dashboard</h1>
      <p className="max-w-xl text-sm leading-6 text-muted">
        You are signed in. Round 2 jury scoring is not part of this release — the organizers will share the finalist list
        after Round 1 results are computed.
      </p>
    </OrganizerShell>
  );
}
