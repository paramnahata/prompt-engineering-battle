import type { Metadata } from 'next';
import './globals.css';
import { getSession } from '@/lib/auth/session';
import LogoutButton from '@/components/auth/LogoutButton';

export const metadata: Metadata = {
  title: 'Prompt Engineering Battle',
  description: 'AI Prompt Optimization & Problem-Solving Challenge',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const session = getSession();

  return (
    <html lang="en" className="dark">
      <body>
        {session && (
          <div className="fixed right-3 top-3 z-[100] flex items-center gap-2 rounded-xl border border-white/10 bg-slate-950/90 p-1.5 shadow-xl backdrop-blur sm:right-5 sm:top-5">
            <span className="px-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">{session.role}</span>
            <LogoutButton />
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
