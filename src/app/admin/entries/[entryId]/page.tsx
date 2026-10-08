import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import EntryDetailClient from '@/components/admin/EntryDetailClient';

export default function EntryDetailPage({ params }: { params: { entryId: string } }) {
  const session = requireRole('admin');
  if (!session) redirect('/organizer/login?next=/admin/entries');

  return (
    <main className="min-h-screen p-8">
      <Link href="/admin/entries" className="text-xs text-muted hover:text-foreground mb-4 inline-block">← Entries</Link>
      <EntryDetailClient entryId={params.entryId} />
    </main>
  );
}
