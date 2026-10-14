import { supabaseAdmin } from '@/lib/supabase/server';
import { requireApiRole, ORGANIZER_ROLES } from '@/lib/auth/session';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Projector screen data: round state + counts only, never names or scores. */
export async function GET() {
  const auth = await requireApiRole(ORGANIZER_ROLES);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    await db.rpc('round1_tick');
    const [registered, present, submitted, round, announcements] = await Promise.all([
      db.from('entries').select('id', { count: 'exact', head: true }),
      db.from('entries').select('id', { count: 'exact', head: true }).eq('present', true),
      db.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
      db.from('rounds').select('round_number, status, round_end_at, paused_at').order('round_number'),
      db.from('announcements').select('id, title, message').eq('active', true).eq('audience', 'all').order('created_at', { ascending: false }).limit(3),
    ]);
    return jsonOk({
      registered: registered.count ?? 0,
      present: present.count ?? 0,
      submitted: submitted.count ?? 0,
      round: (round.data ?? []).find((r) => r.round_number === 1) ?? null,
      round2: (round.data ?? []).find((r) => r.round_number === 2) ?? null,
      announcements: announcements.data ?? [],
      serverNow: new Date().toISOString(),
    });
  } catch (err) {
    return serverError('display stats', err, 'Could not load display data.');
  }
}
