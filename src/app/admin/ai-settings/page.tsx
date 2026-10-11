import Link from 'next/link';
import { redirect } from 'next/navigation';
import { requireRole } from '@/lib/auth/session';
import GeminiSettingsClient from '@/components/admin/GeminiSettingsClient';

export const dynamic = 'force-dynamic';

export default function GeminiSettingsPage() {
  const session = requireRole('admin');
  if (!session) redirect('/organizer/login?next=/admin/ai-settings');
  return (
    <main className="min-h-screen p-8">
      <Link href="/organizer/hub" className="text-xs text-muted hover:text-foreground mb-4 inline-block">← Organizer Hub</Link>
      <div className="max-w-2xl">
        <h1 className="text-2xl font-semibold mb-2">AI Judging &amp; Gemini</h1>
        <p className="text-muted text-sm mb-6">Configure the Gemini model used to evaluate participant submissions.</p>
        <GeminiSettingsClient />
      </div>
    </main>
  );
}
