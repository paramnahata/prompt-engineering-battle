import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/**
 * Counts only — never names, scores, or per-entry data (spec section 27:
 * "Do not expose private participant data" on the display screen).
 */
export async function GET() {
  const db = supabaseAdmin();

  const [{ count: registered }, { count: present }, { count: submitted }, { count: evaluated }, { count: qualified }, { data: round1 }] =
    await Promise.all([
      db.from('entries').select('*', { count: 'exact', head: true }),
      db.from('entries').select('*', { count: 'exact', head: true }).eq('present', true),
      db.from('submissions').select('*', { count: 'exact', head: true }).eq('status', 'submitted'),
      db.from('ai_evaluations').select('*', { count: 'exact', head: true }),
      db.from('round_results').select('*', { count: 'exact', head: true }).eq('qualified', true),
      db.from('rounds').select('status').eq('round_number', 1).single(),
    ]);

  return NextResponse.json({
    registered: registered ?? 0,
    present: present ?? 0,
    submitted: submitted ?? 0,
    evaluated: evaluated ?? 0,
    qualified: qualified ?? 0,
    round1Status: round1?.status ?? 'not_started',
    serverNow: new Date().toISOString(),
  });
}
