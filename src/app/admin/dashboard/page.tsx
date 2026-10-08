import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import AdminDashboardClient from '@/components/admin/AdminDashboardClient';

export default function AdminDashboardPage() {
  const session = requireRole('admin');
  if (!session) redirect('/organizer/login?next=/admin/dashboard');

  return (
    <main className="min-h-screen p-8">
      <Link href="/organizer/hub" className="text-xs text-muted hover:text-foreground mb-4 inline-block">← Organizer Hub</Link>
      <AdminDashboardClient />
    </main>
  );
}
