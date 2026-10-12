import { NextResponse } from 'next/server';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const db = supabaseAdmin();
  const { data: logs, error } = await db
    .from('activity_logs')
    .select('id, entry_id, event_type, created_at, metadata')
    .eq('event_type', 'login')
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) return NextResponse.json({ error: 'Could not load student login activity' }, { status: 500 });

  const entryIds = [...new Set((logs ?? []).map((log) => log.entry_id).filter(Boolean))];
  const { data: entries, error: entriesError } = entryIds.length
    ? await db.from('entries').select('id, entry_code, team_name, is_team, team_members(member_position, full_name)').in('id', entryIds)
    : { data: [], error: null };

  if (entriesError) return NextResponse.json({ error: 'Could not load participant details' }, { status: 500 });

  const byId = new Map((entries ?? []).map((entry) => [entry.id, entry]));
  return NextResponse.json({
    logins: (logs ?? []).map((log) => ({
      id: log.id,
      loggedInAt: log.created_at,
      entry: log.entry_id ? byId.get(log.entry_id) ?? null : null,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
