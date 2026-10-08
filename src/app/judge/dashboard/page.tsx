import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';

export default function JudgeDashboardPage() {
  const session = requireRole('judge');
  if (!session) redirect('/organizer/login?next=/judge/dashboard');

  return (
    <main className="min-h-screen p-8">
      <Link href="/organizer/hub" className="text-xs text-muted hover:text-foreground mb-4 inline-block">← Organizer Hub</Link>
      <h1 className="text-2xl font-semibold mb-2">Judge Dashboard</h1>
      <p className="text-muted">
        Signed in. The finalist queue and Round 2 scoring form (Phase 11) are the next
        build phase.
      </p>
    </main>
  );
}
