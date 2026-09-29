import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireAnyRole } from '@/lib/auth/session';
import RegistrationDeskClient from '@/components/admin/RegistrationDeskClient';

export default function RegistrationDeskPage() {
  const session = requireAnyRole(['admin', 'volunteer']);
  if (!session) redirect('/organizer/login?next=/admin/attendance');

  return (
    <main className="min-h-screen p-8">
      <div className="max-w-4xl mx-auto mb-4">
        <Link href="/organizer/hub" className="text-xs text-muted hover:text-foreground">← Organizer Hub</Link>
      </div>
      <RegistrationDeskClient />
    </main>
  );
}
