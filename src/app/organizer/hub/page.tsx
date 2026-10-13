import Link from 'next/link';
import { requirePageRole, type Role } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';

export const dynamic = 'force-dynamic';

const TILES: { roles: Role[]; href: string; label: string; desc: string }[] = [
  { roles: ['admin'], href: '/admin/dashboard', label: 'Admin Dashboard', desc: 'Round control, live participants, evaluation, results' },
  { roles: ['admin', 'volunteer'], href: '/admin/attendance', label: 'Registration Desk', desc: 'Search, check-in, CSV import, access code' },
  { roles: ['admin'], href: '/admin/challenges', label: 'Challenge Pool', desc: 'Pick common challenges, enable or disable the pool' },
  { roles: ['admin'], href: '/admin/entries', label: 'Entries & Scores', desc: 'Prompts, outputs, AI scores and overrides' },
  { roles: ['admin'], href: '/admin/users', label: 'Accounts', desc: 'Create, reset or remove organizer logins' },
  { roles: ['admin'], href: '/admin/ai-settings', label: 'AI Judging & Gemini', desc: 'Securely configure the judging model' },
  { roles: ['judge'], href: '/judge/dashboard', label: 'Judge Dashboard', desc: 'Jury information' },
  { roles: ['admin', 'volunteer', 'judge'], href: '/display', label: 'Projector / Display', desc: 'Open on the projector (shows the access code)' },
];

export default async function OrganizerHubPage() {
  const session = await requirePageRole(['admin', 'volunteer', 'judge'], '/organizer/hub');
  const tiles = TILES.filter((t) => t.roles.includes(session.role));

  return (
    <OrganizerShell role={session.role} back={{ href: '/', label: 'Home' }}>
      <div className="mb-8">
        <p className="text-[10px] font-bold uppercase tracking-[0.28em] text-cyan-300">Competition operations</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Organizer Hub</h1>
        <p className="mt-2 text-sm text-muted">Everything you need to run Prompt Engineering Battle.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.href} href={t.href} className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.035] p-5 transition duration-200 hover:-translate-y-0.5 hover:border-cyan-300/30 hover:bg-white/[0.06]">
            <div className="absolute right-0 top-0 h-24 w-24 rounded-full bg-violet-500/10 blur-2xl transition group-hover:bg-cyan-500/10" />
            <div className="relative flex items-start justify-between gap-4">
              <div><div className="font-semibold">{t.label}</div><div className="mt-2 text-sm leading-6 text-slate-400">{t.desc}</div></div>
              <span className="text-xl text-cyan-300 transition group-hover:translate-x-1" aria-hidden="true">↗</span>
            </div>
          </Link>
        ))}
      </div>
    </OrganizerShell>
  );
}
