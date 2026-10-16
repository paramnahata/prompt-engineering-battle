'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Maximize2, Moon, Sun, Megaphone, Sparkles, Trophy, Medal, CheckCircle2, PauseCircle, Zap } from 'lucide-react';
import { useServerCountdown } from '@/hooks/useServerCountdown';
import { usePolling } from '@/hooks/usePolling';
import type { Winner } from '@/components/results/Podium';
import { cn } from '@/components/ui/cn';
import s from './display.module.css';
import { MgmLogo, SwayambhuLogo } from '@/components/layout/EventLogos';

type Theme = 'dark' | 'light';
const THEME_KEY = 'peb-display-theme';

/**
 * Projector screen. Shows only what the whole hall may see: the round, its
 * timer, public announcements and — once published — the winners. No access
 * codes, registration numbers or other team data.
 */
interface RoundRow { round_number: number; status: string; round_start_at: string | null; round_end_at: string | null; paused_at: string | null; total_paused_seconds: number | null }
interface DisplayData {
  round: RoundRow | null;
  round2: RoundRow | null;
  announcements: { id: string; title: string | null; message: string }[];
  twistRevealed?: boolean;
  winners?: Winner[];
  serverNow: string;
}

const TAGLINES = ['Write the prompt that wins.', 'Four challenges. One final.', 'Clarity · Context · Constraints', 'Top teams advance to the final round.'];

export default function DisplayScreen() {
  const [data, setData] = useState<DisplayData | null>(null);
  const [clock, setClock] = useState('');
  const [pointer, setPointer] = useState(false);
  const [theme, setTheme] = useState<Theme>('dark');

  // Light / dark, remembered on this computer (storage may be unavailable — then it just resets).
  useEffect(() => {
    try { if (window.localStorage.getItem(THEME_KEY) === 'light') setTheme('light'); } catch { /* ignore */ }
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const next: Theme = t === 'dark' ? 'light' : 'dark';
      try { window.localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
      return next;
    });
  }, []);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if ((e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) toggleTheme(); };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [toggleTheme]);

  const load = useCallback(async () => {
    const res = await fetch('/api/display/stats', { cache: 'no-store' });
    if (res.status === 401 || res.status === 403) {
      window.location.replace('/organizer/login?next=/display');
      return;
    }
    if (!res.ok) throw new Error('stats');
    setData(await res.json());
  }, []);
  usePolling(load, 4000, { pauseWhenHidden: false });

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  // The pointer (and the full-screen button) only appear while the mouse moves.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const move = () => { setPointer(true); clearTimeout(timer); timer = setTimeout(() => setPointer(false), 2500); };
    window.addEventListener('mousemove', move);
    return () => { window.removeEventListener('mousemove', move); clearTimeout(timer); };
  }, []);

  // Once Round 2 has started, the projector follows Round 2.
  const round = data?.round2 && data.round2.status !== 'not_started' ? data.round2 : data?.round ?? null;
  const isFinal = round?.round_number === 2;
  const secondsLeft = useServerCountdown({ endAtIso: round?.status === 'running' ? round.round_end_at : null, serverNowIso: data?.serverNow ?? null });
  const total = round?.round_start_at && round.round_end_at
    ? Math.max(1, (new Date(round.round_end_at).getTime() - new Date(round.round_start_at).getTime()) / 1000 - (round.total_paused_seconds ?? 0))
    : null;
  const pausedLeft = round?.status === 'paused' && round.round_end_at && round.paused_at
    ? Math.max(0, Math.round((new Date(round.round_end_at).getTime() - new Date(round.paused_at).getTime()) / 1000)) : null;
  const left = round?.status === 'running' ? secondsLeft : pausedLeft;
  const winners = data?.winners ?? [];
  const mood = winners.length ? 'gold'
    : round?.status === 'running' && left !== null ? (left <= 60 ? 'urgent' : left <= 300 ? 'warn' : 'calm') : 'calm';

  const fullscreen = () => { void document.documentElement.requestFullscreen?.().catch(() => {}); };

  return (
    <div className={s.stage} data-mood={mood} data-theme={theme} data-pointer={pointer ? 'on' : 'off'}>
      <Backdrop />

      <div className="relative z-10 flex min-h-screen flex-col px-[4vw] py-[3.5vh]">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-5">
            <MgmLogo size="xl" tone={theme} />
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-peb-gradient font-display text-2xl font-bold text-white shadow-glow">&gt;_</span>
            <div>
              <div className="font-display text-3xl font-semibold leading-none text-white" style={{ fontVariationSettings: "'wdth' 84" }}>Prompt Engineering Battle</div>
              <div className="mt-1.5 text-sm uppercase tracking-[0.3em] text-muted">Swayambhu 2026</div>
            </div>
          </div>
          <div className="flex items-center gap-6">
            {pointer && <button type="button" onClick={toggleTheme} className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/10" title="Switch light / dark (T)">{theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button>}
            {pointer && <button type="button" onClick={fullscreen} className="flex items-center gap-2 rounded-full border border-white/15 px-4 py-2 text-sm text-slate-200 hover:bg-white/10"><Maximize2 className="h-4 w-4" aria-hidden="true" />Full screen</button>}
            <div className="flex items-center gap-3 rounded-full border border-white/10 bg-white/[0.04] px-5 py-2.5 backdrop-blur">
              <span className={s.liveDot} aria-hidden="true" />
              <span className="font-display text-2xl font-semibold tabular text-white">{clock}</span>
            </div>
            <SwayambhuLogo size="xl" tone={theme} />
          </div>
        </header>

        <main className="flex flex-1 flex-col items-center justify-center py-[3vh] text-center">
          {winners.length ? <WinnersReveal winners={winners} />
            : !round || round.status === 'not_started' ? <Idle />
            : round.status === 'ended' ? <Ended isFinal={isFinal} />
            : <Countdown key={`${round.round_number}-${round.round_start_at}`} isFinal={isFinal} status={round.status} left={left} total={total} twist={isFinal && Boolean(data?.twistRevealed)} />}
        </main>

        <Ticker items={data?.announcements ?? []} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
function Backdrop() {
  // Deterministic sparks so the server and client render the same markup.
  const sparks = useMemo(() => Array.from({ length: 26 }, (_, i) => ({
    left: (i * 37) % 100, delay: (i * 1.7) % 14, duration: 12 + ((i * 7) % 10), dx: ((i % 5) - 2) * 30, size: 2 + (i % 3),
  })), []);
  return (
    <div aria-hidden="true">
      <div className={s.aurora}><div className={cn(s.blob, s.blobA)} /><div className={cn(s.blob, s.blobB)} /><div className={cn(s.blob, s.blobC)} /></div>
      <div className={s.grid} />
      <div className="pointer-events-none absolute inset-0">
        {sparks.map((p, i) => (
          <span key={i} className={s.spark} style={{ left: `${p.left}%`, bottom: '-2vh', width: p.size, height: p.size, animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, ['--dx' as string]: `${p.dx}px` }} />
        ))}
      </div>
    </div>
  );
}

function Idle() {
  const [i, setI] = useState(0);
  useEffect(() => { const t = setInterval(() => setI((x) => (x + 1) % TAGLINES.length), 4200); return () => clearInterval(t); }, []);
  return (
    <div className={s.enter}>
      <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-violet-300/25 bg-violet-400/10 px-5 py-2 text-lg font-medium text-violet-100">
        <Sparkles className="h-5 w-5" aria-hidden="true" />Get ready
      </div>
      <h1 className={cn('font-display text-[min(8.5vw,15vh)] font-semibold leading-[0.95]', s.titleSweep)} style={{ fontVariationSettings: "'wdth' 82" }}>
        Prompt Engineering<br />Battle
      </h1>
      <p key={i} className={cn('mt-10 text-[2.4vw] text-slate-300', s.rotator)}>{TAGLINES[i]}</p>
    </div>
  );
}

function Digits({ value }: { value: string }) {
  return (
    <span className={s.digits} aria-label={value}>
      {value.split('').map((ch, i) => ch === ':'
        ? <span key={`c${i}`} className={s.colon}>:</span>
        : <span key={`${i}-${ch}`} className={s.digit}>{ch}</span>)}
    </span>
  );
}

const fmt = (sec: number) => {
  const m = Math.floor(sec / 60);
  const r = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
};

function Countdown({ isFinal, status, left, total, twist }: { isFinal: boolean; status: string; left: number | null; total: number | null; twist: boolean }) {
  const paused = status === 'paused';
  const pct = total && left !== null ? Math.min(100, Math.max(0, 100 - (left / total) * 100)) : 0;
  return (
    <div className={cn('w-full max-w-[78vw]', s.enter)}>
      <div className="flex items-center justify-center gap-4">
        <span className="rounded-full border border-white/15 bg-white/[0.05] px-5 py-2 text-xl font-semibold uppercase tracking-[0.25em] text-white">{isFinal ? 'The final · Round 2' : 'Round 1'}</span>
        {paused
          ? <span className="flex items-center gap-2 rounded-full bg-amber-400/15 px-5 py-2 text-xl font-medium text-amber-200"><PauseCircle className="h-6 w-6" aria-hidden="true" />Paused</span>
          : <span className="flex items-center gap-2.5 rounded-full bg-emerald-400/10 px-5 py-2 text-xl font-medium text-emerald-200"><span className={s.liveDot} aria-hidden="true" />In progress</span>}
      </div>
      {twist && (
        <div className={cn('mx-auto mt-8 flex w-fit items-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/10 px-8 py-4 text-3xl font-semibold text-amber-100', s.twist)}>
          <Zap className="h-8 w-8" aria-hidden="true" />The twist is live — check your screen
        </div>
      )}
      <div className={cn('font-display font-semibold text-white', twist ? 'mt-4 text-[min(15vw,26vh)]' : 'mt-8 text-[min(19vw,34vh)]', s.timerGlow, paused && s.breathe)}>
        {left === null ? <span className="text-muted">--:--</span> : <Digits value={fmt(left)} />}
      </div>
      <div className="mx-auto mt-6 w-full">
        <div className={s.track}><div className={s.fill} style={{ width: `${pct}%` }} /></div>
        <div className="mt-3 flex justify-between text-lg text-muted"><span>{paused ? 'Timer frozen' : 'Time remaining'}</span><span>{Math.round(pct)}% elapsed</span></div>
      </div>
    </div>
  );
}

function Ended({ isFinal }: { isFinal: boolean }) {
  return (
    <div className={s.enter}>
      <CheckCircle2 className="mx-auto h-24 w-24 text-emerald-300" aria-hidden="true" />
      <h1 className={cn('mt-6 font-display text-[7vw] font-semibold leading-none', s.titleSweep)}>{isFinal ? 'The final is over' : 'Round 1 complete'}</h1>
      <p className={cn('mt-8 text-[2.2vw] text-slate-300', s.breathe)}>{isFinal ? 'The jury is deciding. Winners will be announced soon…' : 'Answers are being evaluated. Results will be announced soon…'}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
const PLACE = {
  1: { label: 'Winner · 1st place', delay: 3.4, tone: 'text-amber-200', card: 'border-amber-300/50 bg-gradient-to-b from-amber-400/[0.16] to-amber-400/[0.03]', size: 'text-[3.6vw]', minH: 'min-h-[34vh]' },
  2: { label: 'Winner · 2nd place', delay: 1.6, tone: 'text-slate-200', card: 'border-slate-200/30 bg-gradient-to-b from-slate-200/[0.10] to-transparent', size: 'text-[2.7vw]', minH: 'min-h-[27vh]' },
} as const;

function WinnersReveal({ winners }: { winners: Winner[] }) {
  const order = ([2, 1] as const).filter((p) => winners.some((w) => w.rank === p));
  return (
    <div className="w-full">
      <Confetti />
      <h1 className={cn('font-display text-[5vw] font-semibold leading-none', s.titleSweep, s.reveal)}>And the winners are…</h1>
      <div className="mx-auto mt-[6vh] grid max-w-[72vw] grid-cols-[1fr_1.3fr] items-end gap-[3vw]">
        {order.map((p) => {
          const meta = PLACE[p];
          const teams = winners.filter((w) => w.rank === p);
          return (
            <div key={p} className={cn('relative flex flex-col items-center justify-end rounded-3xl border px-[2vw] pb-[4vh] pt-[3vh]', meta.card, meta.minH, s.place, p === 1 && s.first)}
              style={{ animationDelay: `${meta.delay}s` }}>
              <div className={cn('mb-4 flex items-center gap-2 text-xl font-semibold uppercase tracking-[0.25em]', meta.tone)}>
                {p === 1 ? <Trophy className={cn('h-10 w-10', s.trophy)} aria-hidden="true" /> : <Medal className="h-7 w-7" aria-hidden="true" />}
                {meta.label}{teams.length > 1 ? ' (tie)' : ''}
              </div>
              {teams.map((w) => (
                <div key={`${w.entryNumber}`} className="mt-2">
                  <div className={cn('font-display font-semibold leading-tight text-white', meta.size)}>{w.teamName || w.members.join(' & ') || `Entry ${w.entryNumber}`}</div>
                  {w.teamName && w.members.length > 0 && <div className="mt-2 text-[1.3vw] text-slate-300">{w.members.join(' · ')}</div>}
                  {w.score !== null && w.score !== undefined && <div className="mt-3 font-display text-[1.8vw] font-semibold tabular text-white/90">{Number(w.score).toFixed(1)}</div>}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const CONFETTI_COLORS = ['#8B6CFF', '#3D7EFF', '#FFD166', '#FF7A59', '#5EEAD4', '#F472B6', '#FFFFFF'];
function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 120 }, (_, i) => ({
    left: (i * 53) % 100, delay: 3.4 + ((i * 13) % 40) / 10, duration: 4 + ((i * 7) % 30) / 10,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length], dx: ((i % 9) - 4) * 40, rot: 360 + (i % 5) * 180, w: 6 + (i % 4) * 2, h: 10 + (i % 3) * 5, round: i % 4 === 0,
  })), []);
  return (
    <div className={s.confetti} aria-hidden="true">
      {pieces.map((p, i) => (
        <span key={i} className={s.piece} style={{ left: `${p.left}%`, background: p.color, width: p.w, height: p.round ? p.w : p.h, borderRadius: p.round ? 9999 : 2,
          animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`, ['--dx' as string]: `${p.dx}px`, ['--rot' as string]: `${p.rot}deg` }} />
      ))}
    </div>
  );
}

function Ticker({ items }: { items: DisplayData['announcements'] }) {
  const [i, setI] = useState(0);
  useEffect(() => { setI(0); }, [items.length]);
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI((x) => (x + 1) % items.length), 9000);
    return () => clearInterval(t);
  }, [items.length]);
  const a = items[i];
  if (!a) return <div className="h-[9vh]" />;
  return (
    <footer className="flex min-h-[9vh] items-center gap-5 rounded-2xl border border-white/10 bg-white/[0.04] px-7 py-4 backdrop-blur">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-violet-500/20 text-violet-200"><Megaphone className="h-6 w-6" aria-hidden="true" /></span>
      <div key={a.id} className={cn('min-w-0 flex-1 text-left', s.ticker)}>
        {a.title && <div className="text-lg font-semibold uppercase tracking-[0.18em] text-violet-200">{a.title}</div>}
        <div className="text-[1.9vw] leading-snug text-white">{a.message}</div>
      </div>
      {items.length > 1 && <div className="flex gap-1.5">{items.map((x, j) => <span key={x.id} className={cn('h-2 rounded-full transition-all duration-500', j === i ? 'w-8 bg-violet-300' : 'w-2 bg-white/25')} />)}</div>}
    </footer>
  );
}
