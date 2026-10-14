'use client';

import Link from 'next/link';
import { useCallback } from 'react';
import { Check } from 'lucide-react';
import { useHeartbeat } from '@/hooks/useHeartbeat';
import { StudentCenter } from './StudentShell';

export default function SubmittedScreen({ submissionRef, entryNumber }: { submissionRef: string | null; entryNumber: number | null }) {
  useHeartbeat(useCallback(() => window.location.replace('/student/login'), []));
  return (
    <StudentCenter entryNumber={entryNumber} icon={<Check className="h-6 w-6" />} title="Round 1 answers submitted"
      action={<Link href="/student/waiting" className="peb-btn-primary w-full">Go to my dashboard</Link>}>
      <p>All four answers are locked in and queued for evaluation.</p>
      {submissionRef && <p className="mt-3">Reference <span className="font-display text-xl font-semibold tabular text-white">{submissionRef}</span></p>}
      <p className="mt-3 text-sm text-muted">Results and announcements will appear on your dashboard.</p>
    </StudentCenter>
  );
}
