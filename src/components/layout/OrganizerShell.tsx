import { supabaseAdmin } from '@/lib/supabase/server';
import type { Role } from '@/lib/auth/session';
import { ToastProvider } from '@/components/ui/Toast';
import OrganizerNav from './OrganizerNav';
import RoundPulse from './RoundPulse';
import { navFor } from './nav';

async function displayName(role: Role, userId?: string): Promise<string> {
  if (!userId) return role;
  try {
    const table = role === 'judge' ? 'judges' : 'admins';
    const { data } = await supabaseAdmin().from(table).select('full_name, email').eq('id', userId).maybeSingle();
    return data?.full_name || data?.email || role;
  } catch {
    return role;
  }
}

/** Organizer frame: sidebar navigation (filtered by role), live round status, identity and sign-out. */
export default async function OrganizerShell({ role, userId, children, wide = true }: {
  role: Role; userId?: string; children: React.ReactNode; wide?: boolean; back?: { href: string; label: string };
}) {
  const name = await displayName(role, userId);
  return (
    <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-violet-600 focus:px-3 focus:py-2 focus:text-white">Skip to content</a>
      <div className="lg:pl-64">
        {/* No backdrop-filter here: it would become the containing block for the fixed sidebar/drawer. */}
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-line bg-background/95 px-4 sm:px-6">
          <OrganizerNav groups={navFor(role)} name={name} role={role} />
          <div className="flex-1" />
          <RoundPulse />
        </header>
        <main id="main" className={`mx-auto px-4 py-6 sm:px-6 sm:py-8 ${wide ? 'max-w-[1400px]' : 'max-w-4xl'}`}>{children}</main>
      </div>
    </ToastProvider>
  );
}

