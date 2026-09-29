import Link from 'next/link';

const portals = [
  { href: '/student/login', label: 'Student Login', desc: 'Entry ID + event access code' },
  { href: '/organizer/login', label: 'Organizer Login', desc: 'Admin, Registration Desk, Judge' },
];

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-10 p-10">
      <div className="text-center">
        <h1 className="text-4xl font-bold bg-gradient-to-r from-accent via-accent-blue to-accent-cyan bg-clip-text text-transparent">
          PROMPT ENGINEERING BATTLE
        </h1>
        <p className="text-muted mt-2">AI Prompt Optimization &amp; Problem-Solving Challenge</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
        {portals.map((p) => (
          <Link key={p.href} href={p.href} className="peb-card hover:border-accent transition-colors text-center py-8">
            <div className="font-semibold text-lg">{p.label}</div>
            <div className="text-sm text-muted mt-1">{p.desc}</div>
          </Link>
        ))}
      </div>
    </main>
  );
}
