import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = requireRole('student');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const { data, error } = await supabaseAdmin()
    .from('rounds').select('status, round_start_at, round_end_at')
    .eq('round_number', 1).single();

  if (error || !data) {
    return NextResponse.json({ status: 'not_started', serverNow: new Date().toISOString() });
  }
  return NextResponse.json({ ...data, serverNow: new Date().toISOString() });
}
