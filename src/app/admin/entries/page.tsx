import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import EntriesListClient from '@/components/admin/EntriesListClient';

export default function EntriesPage() {
  const session = requireRole('admin');
  if (!session) redirect('/organizer/login?next=/admin/entries');

  return (
    <main className="min-h-screen p-8">
      <Link href="/organizer/hub" className="text-xs text-muted hover:text-foreground mb-4 inline-block">← Organizer Hub</Link>
      <EntriesListClient />
    </main>
  );
}
