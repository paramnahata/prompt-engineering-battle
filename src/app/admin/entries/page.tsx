import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import EntriesListClient from '@/components/admin/EntriesListClient';
import LogoutButton from '@/components/auth/LogoutButton';

export default function EntriesPage() {
  const session = requireRole('admin');
  if (!session) redirect('/organizer/login?next=/admin/entries');

  return (
    <main className="min-h-screen p-8">
      <div className="mb-4 flex items-center justify-between"><Link href="/organizer/hub" className="text-xs text-muted hover:text-foreground inline-block">← Organizer Hub</Link><LogoutButton /></div>
      <EntriesListClient />
    </main>
  );
}
