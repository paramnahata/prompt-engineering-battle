'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase/client';

export default function WaitingPage() {
  const router = useRouter();
  const [status, setStatus] = useState('not_started');

  useEffect(() => {
    const supabase = supabaseBrowser();
    const check = async () => {
      const { data } = await supabase.from('rounds').select('status').eq('round_number', 1).single();
      if (data) setStatus(data.status);
      if (data?.status === 'running') router.push('/student/round1');
    };
    check();
    const channel = supabase
      .channel('waiting-room')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'rounds' }, check)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [router]);

  return (
    <main className="min-h-screen flex flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-semibold">Welcome to Prompt Engineering Battle</h1>
      <p className="text-muted">
        {status === 'not_started' && 'Please wait for Round 1 to begin.'}
        {status === 'paused' && 'Round 1 is paused. Please stand by.'}
        {status === 'ended' && 'Round 1 has ended.'}
      </p>
      <div className="h-2 w-2 rounded-full bg-accent animate-pulse-glow" />
    </main>
  );
}
