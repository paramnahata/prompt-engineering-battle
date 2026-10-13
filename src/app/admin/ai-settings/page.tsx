import { requirePageRole } from '@/lib/auth/session';
import OrganizerShell from '@/components/layout/OrganizerShell';
import GeminiSettingsClient from '@/components/admin/GeminiSettingsClient';

export const dynamic = 'force-dynamic';

export default async function GeminiSettingsPage() {
  const session = await requirePageRole(['admin'], '/admin/ai-settings');
  return (
    <OrganizerShell role={session.role}>
      <div className="max-w-2xl">
        <h1 className="mb-2 text-2xl font-semibold">AI Judging &amp; Gemini</h1>
        <p className="mb-6 text-sm text-muted">Configure the Gemini key used to evaluate submissions. The key is validated, encrypted and never shown again.</p>
        <GeminiSettingsClient />
      </div>
    </OrganizerShell>
  );
}
