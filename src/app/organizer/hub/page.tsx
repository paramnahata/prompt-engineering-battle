import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

const ALL_TILES = [
  { role: 'admin', href: '/admin/dashboard', label: 'Admin Dashboard', desc: 'Event control center' },
  { role: 'admin', href: '/admin/users', label: 'Accounts', desc: 'Create/reset/remove logins' },
  { roles: ['admin', 'volunteer'], href: '/admin/attendance', label: 'Registration Desk', desc: 'CSV import, check-in, attendance' },
  { role: 'judge', href: '/judge/dashboard', label: 'Judge Dashboard', desc: 'Round 2 scoring' },
  { any: true, href: '/display', label: 'Projector / Display', desc: 'Open on the projector screen' },
] as const;

export default function OrganizerHubPage() {
  const session = getSession();
  if (!session || !['admin', 'volunteer', 'judge'].includes(session.role)) {
    redirect('/organizer/login?next=/organizer/hub');
  }

  const tiles = ALL_TILES.filter((t) => {
    if ('any' in t) return true;
    if ('role' in t) return t.role === session.role;
    if ('roles' in t) return (t.roles as readonly string[]).includes(session.role);
    return false;
  });

  return (
    <main className="min-h-screen p-8">
      <h1 className="text-2xl font-semibold mb-1">Organizer Hub</h1>
      <p className="text-muted text-sm mb-6 capitalize">Signed in as {session.role}</p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="peb-card hover:border-accent transition-colors">
            <div className="font-medium">{t.label}</div>
            <div className="text-sm text-muted">{t.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
