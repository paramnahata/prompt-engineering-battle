import Link from 'next/link';
import { ArrowUpRight, BrainCircuit, ShieldCheck, Swords, Users } from 'lucide-react';

const portals = [
  { href: '/student/login', label: 'Student Arena', desc: 'Enter your Entry ID and event access code to compete.', icon: Swords, accent: 'from-violet-500/20 to-indigo-500/5', tag: 'FOR PARTICIPANTS' },
  { href: '/organizer/login', label: 'Organizer Console', desc: 'Manage the round, entries, evaluation and event operations.', icon: ShieldCheck, accent: 'from-cyan-500/20 to-blue-500/5', tag: 'STAFF ACCESS' },
];

const features = [
  { title: 'AI-powered judging', detail: 'Consistent rubric-based evaluation for every prompt.' },
  { title: 'Live round control', detail: 'One place to launch the arena and monitor progress.' },
  { title: 'Fair challenge mix', detail: 'Assigned challenges and server-controlled timers.' },
];

export default function Home() {
  return (
    <main className="min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute left-1/2 top-0 h-[32rem] w-[56rem] -translate-x-1/2 rounded-full bg-violet-600/15 blur-[120px]" />
      <div className="relative mx-auto max-w-7xl px-5 py-8 sm:px-8 lg:py-12">
        <nav className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-violet-300/20 bg-gradient-to-br from-violet-500/30 to-cyan-500/10"><BrainCircuit className="h-5 w-5 text-cyan-200" /></span>
            <span className="text-sm font-bold tracking-wide">PEB<span className="text-cyan-300">.</span></span>
          </Link>
          <span className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">Competition platform</span>
        </nav>

        <section className="grid items-center gap-12 pb-16 pt-16 lg:grid-cols-[1.15fr_0.85fr] lg:pb-24 lg:pt-24">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.06] px-3 py-2 text-[10px] font-bold uppercase tracking-[0.22em] text-cyan-200">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" /> Think sharper. Prompt better.
            </div>
            <h1 className="mt-6 max-w-3xl text-5xl font-black leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
              The art of the prompt. <span className="bg-gradient-to-r from-violet-300 via-indigo-200 to-cyan-200 bg-clip-text text-transparent">The thrill of the battle.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-slate-400 sm:text-lg">
              A live prompt-engineering arena where clear thinking, creative instructions and strong AI outputs meet measurable evaluation.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4 text-xs text-slate-400">
              <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4 text-cyan-300" /> Server-controlled rounds</span>
              <span className="inline-flex items-center gap-2"><BrainCircuit className="h-4 w-4 text-violet-300" /> AI-assisted evaluation</span>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-4 rounded-[2rem] bg-gradient-to-br from-violet-600/15 via-transparent to-cyan-500/10 blur-2xl" />
            <div className="relative rounded-[2rem] border border-white/10 bg-slate-950/60 p-5 shadow-2xl shadow-black/30 backdrop-blur-xl sm:p-7">
              <div className="flex items-center justify-between border-b border-white/10 pb-5">
                <div><p className="text-xs font-bold uppercase tracking-[0.2em] text-cyan-300">The arena</p><h2 className="mt-1 text-xl font-bold">Your next challenge</h2></div>
                <span className="rounded-xl border border-violet-300/20 bg-violet-300/10 p-3"><Swords className="h-5 w-5 text-violet-200" /></span>
              </div>
              <div className="mt-5 space-y-3">
                {['Understand the problem', 'Craft a precise prompt', 'Submit the AI output', 'Get evaluated against the rubric'].map((item, i) => (
                  <div key={item} className="flex items-center gap-4 rounded-2xl border border-white/[0.07] bg-white/[0.025] p-4">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/25 to-cyan-500/10 text-xs font-bold text-cyan-100">{String(i + 1).padStart(2, '0')}</span>
                    <span className="text-sm font-medium text-slate-200">{item}</span>
                  </div>
                ))}
              </div>
              <div className="mt-5 rounded-2xl border border-cyan-300/10 bg-cyan-300/[0.04] p-4 text-xs leading-6 text-slate-400">
                Every challenge is timed. Your work is autosaved while you focus on solving the problem.
              </div>
            </div>
          </div>
        </section>

        <section className="border-t border-white/10 pt-10">
          <div className="mb-6 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><p className="text-[10px] font-bold uppercase tracking-[0.25em] text-violet-300">Choose your portal</p><h2 className="mt-2 text-2xl font-bold sm:text-3xl">Ready when you are.</h2></div>
            <p className="text-sm text-slate-500">Secure entry · Live status · Clear results</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            {portals.map((p) => {
              const Icon = p.icon;
              return (
                <Link key={p.href} href={p.href} className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.035] p-6 transition duration-300 hover:-translate-y-1 hover:border-cyan-300/30 hover:bg-white/[0.06] sm:p-8">
                  <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${p.accent} opacity-70`} />
                  <div className="relative flex items-start justify-between gap-4">
                    <div><span className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">{p.tag}</span><h3 className="mt-3 text-2xl font-bold">{p.label}</h3><p className="mt-3 max-w-sm text-sm leading-6 text-slate-400">{p.desc}</p></div>
                    <span className="rounded-2xl border border-white/10 bg-slate-950/60 p-3"><Icon className="h-5 w-5 text-cyan-200" /></span>
                  </div>
                  <div className="relative mt-8 flex items-center gap-2 text-sm font-semibold text-cyan-200">Open portal <ArrowUpRight className="h-4 w-4 transition group-hover:translate-x-1 group-hover:-translate-y-1" /></div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="grid gap-4 py-12 sm:grid-cols-3">
          {features.map((f) => <div key={f.title} className="border-l border-violet-300/30 pl-4"><h3 className="text-sm font-bold">{f.title}</h3><p className="mt-2 text-xs leading-6 text-slate-500">{f.detail}</p></div>)}
        </section>
        <footer className="flex flex-col gap-2 border-t border-white/10 py-6 text-xs text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Prompt Engineering Battle</span><span className="inline-flex items-center gap-2"><Users className="h-3.5 w-3.5" /> Built for focused competition</span>
        </footer>
      </div>
    </main>
  );
}
