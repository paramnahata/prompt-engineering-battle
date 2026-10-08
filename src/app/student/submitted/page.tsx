'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

function SubmittedContent() {
  const params = useSearchParams();
  const ref = params.get('ref');

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl">✅</div>
      <h1 className="text-2xl font-semibold">Submission received successfully</h1>
      {ref && (
        <p className="text-muted">
          Submission ID: <span className="font-mono text-foreground">{ref}</span>
        </p>
      )}
      <p className="text-muted text-sm max-w-sm">
        Your answers for Round 1 are locked in. Results will be announced by the organizers — please wait here or
        check the display screen.
      </p>
    </main>
  );
}

export default function SubmittedPage() {
  return (
    <Suspense fallback={null}>
      <SubmittedContent />
    </Suspense>
  );
}
