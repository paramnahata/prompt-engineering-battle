import Link from 'next/link';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { BrandMark } from '@/components/layout/Brand';

const ROUNDS = [
  { name: 'Round 1', detail: 'Four timed prompt challenges per team — two shared by everyone, two drawn for you. Every answer is scored by an AI judge against the same rubric.' },
  { name: 'Results', detail: 'The top teams qualify. Organizers publish scores and the finalist list to your dashboard.' },
  { name: 'Round 2', detail: 'One real-world problem, a live jury that asks questions, and possibly a twist halfway through.' },
];

export default function Home() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl">
        <nav className="flex items-center justify-between">
          <BrandMark />
          <Link href="/organizer/login" className="rounded-md px-3 py-1.5 text-sm text-slate-400 hover:bg-white/5 hover:text-white">Organizer sign in</Link>
        </nav>

        <section className="grid gap-12 pb-16 pt-16 lg:grid-cols-[1.3fr_1fr] lg:items-end lg:pt-24">
          <div>
            <p className="text-sm text-violet-200">SWAYAMBHU 2026</p>
            <h1 className="mt-4 font-display text-[3.4rem] font-semibold leading-[0.98] text-white sm:text-[5rem]" style={{ fontVariationSettings: "'wdth' 80" }}>
              Prompt Engineering Battle
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-8 text-slate-300">
              A live contest in telling an AI exactly what you mean. Clear thinking beats long prompts; the clock is always running.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/student/login" className="peb-btn-primary min-h-[3rem] px-6 text-base">Enter as a team <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
              <Link href="/organizer/login" className="peb-btn-secondary min-h-[3rem] px-6 text-base">Organizer console</Link>
            </div>
          </div>

          <figure className="peb-panel overflow-hidden" aria-label="Example prompt">
            <div className="flex items-center justify-between border-b border-line/70 px-4 py-2.5 text-xs text-muted">
              <span>Challenge 3 of 4</span>
              <span className="font-display text-base font-semibold tabular text-white">04:12</span>
            </div>
            <pre className="whitespace-pre-wrap px-5 py-5 font-sans text-[0.95rem] leading-7 text-slate-200">
{`You are a museum guide writing for 10-year-olds.
Explain why the sky is blue in exactly 3 sentences.
Use one everyday comparison. No jargon.`}<span className="ml-0.5 inline-block h-5 w-[2px] translate-y-1 animate-pulse-glow bg-violet-300" aria-hidden="true" />
            </pre>
            <figcaption className="flex items-center justify-between border-t border-line/70 px-4 py-2.5 text-xs text-muted">
              <span>31 / 150 words</span><span className="text-emerald-300">Saved</span>
            </figcaption>
          </figure>
        </section>

        <section className="border-t border-line pt-10" aria-labelledby="how">
          <h2 id="how" className="text-2xl font-semibold text-white">How the day runs</h2>
          <ol className="mt-6 grid gap-6 md:grid-cols-3">
            {ROUNDS.map((r, i) => (
              <li key={r.name} className="flex gap-4">
                <span className="font-display text-4xl font-semibold leading-none text-violet-300/80">{i + 1}</span>
                <div><h3 className="text-lg font-semibold text-white">{r.name}</h3><p className="mt-1 leading-7 text-slate-400">{r.detail}</p></div>
              </li>
            ))}
          </ol>
        </section>

        <footer className="mt-16 flex flex-col gap-2 border-t border-line py-6 text-sm text-faint sm:flex-row sm:items-center sm:justify-between">
          <span>Prompt Engineering Battle · SWAYAMBHU 2026</span>
          <span className="inline-flex items-center gap-2"><ShieldCheck className="h-4 w-4" aria-hidden="true" />Timers and scores are controlled by the server</span>
        </footer>
      </div>
    </main>
  );
}
