import Link from 'next/link';
import LogoutButton from '@/components/auth/LogoutButton';
import type { Role } from '@/lib/auth/session';

/** Shared frame for organizer pages: back navigation, who is signed in, sign out. */
export default function OrganizerShell({
  role,
  back = { href: '/organizer/hub', label: 'Organizer Hub' },
  children,
  wide = false,
}: {
  role: Role;
  back?: { href: string; label: string };
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-8 sm:py-8">
      <div className={`mx-auto ${wide ? 'max-w-7xl' : 'max-w-5xl'}`}>
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link href={back.href} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-400 transition hover:bg-white/5 hover:text-white">
            <span aria-hidden="true">←</span> {back.label}
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[11px] font-semibold capitalize text-slate-300 sm:inline">
              Signed in · {role}
            </span>
            <LogoutButton />
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}
