'use client';

import { useCallback } from 'react';
import LogoutButton from '@/components/auth/LogoutButton';
import { useHeartbeat } from '@/hooks/useHeartbeat';

export default function SubmittedScreen({ submissionRef, entryNumber }: { submissionRef: string | null; entryNumber: number | null }) {
  useHeartbeat(useCallback(() => window.location.replace('/student/login'), []));
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl" aria-hidden="true">✅</div>
      <h1 className="text-2xl font-semibold">Submission received</h1>
      {entryNumber !== null && <p className="text-sm text-muted">Entry {entryNumber}</p>}
      {submissionRef && <p className="text-muted">Submission ID: <span className="font-mono text-foreground">{submissionRef}</span></p>}
      <p className="max-w-sm text-sm text-muted">Your Round 1 answers are locked in. Results will be announced by the organizers.</p>
      <LogoutButton redirectTo="/" className="peb-btn-secondary mt-4" />
    </main>
  );
}
