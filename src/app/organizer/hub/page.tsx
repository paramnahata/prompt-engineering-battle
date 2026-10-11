import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

const ALL_TILES = [
  { role: 'admin', href: '/admin/dashboard', label: 'Admin Dashboard', desc: 'Event control center' },
  { role: 'admin', href: '/admin/users', label: 'Accounts', desc: 'Create/reset/remove logins' },
  { role: 'admin', href: '/admin/ai-settings', label: 'AI Judging & Gemini', desc: 'Securely configure the judging model' },
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
    <main className="min-h-screen px-5 py-8 sm:px-8 lg:py-12">
      <div className="mx-auto max-w-5xl">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300">Competition operations</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Organizer Hub</h1>
            <p className="mt-2 text-sm text-muted">Everything you need to run Prompt Engineering Battle.</p>
          </div>
          <span className="w-fit rounded-full border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold capitalize text-slate-300">Signed in · {session.role}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tiles.map((t) => (
            <Link key={t.href} href={t.href} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.06]">
              <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl transition group-hover:bg-cyan-500/10" />
              <div className="relative flex items-start justify-between gap-4">
                <div><div className="font-semibold">{t.label}</div><div className="mt-2 text-sm leading-6 text-slate-400">{t.desc}</div></div>
                <span className="text-xl text-cyan-300 transition group-hover:translate-x-1">↗</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </main>
  );
}
