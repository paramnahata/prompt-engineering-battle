import { supabaseAdmin } from '@/lib/supabase/server';
import { requireApiRole, ORGANIZER_ROLES } from '@/lib/auth/session';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/**
 * Projector screen data: round state, timer, public announcements and — only
 * once the final results are published — the winners. No registration or
 * submission counts, no access codes, no other team data.
 */
export async function GET() {
  const auth = await requireApiRole(ORGANIZER_ROLES);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    await db.rpc('round1_tick');
    await db.rpc('round2_tick');
    const [round, announcements, pub, twist] = await Promise.all([
      db.from('rounds').select('round_number, status, round_start_at, round_end_at, paused_at, total_paused_seconds').order('round_number'),
      db.from('announcements').select('id, title, message').eq('active', true).eq('audience', 'all').order('created_at', { ascending: false }).limit(3),
      db.from('event_settings').select('value').eq('key', 'results_publication').maybeSingle(),
      db.from('round2_states').select('entry_id', { count: 'exact', head: true }).not('twist_revealed_at', 'is', null),
    ]);
    const finalPub = ((pub.data?.value ?? {}) as { final?: { published?: boolean; showScore?: boolean } }).final;
    let winners: { rank: number; entryNumber: number | null; teamName: string | null; members: string[]; score: number | null }[] = [];
    if (finalPub?.published) {
      const { data } = await db.from('final_results')
        .select('rank, final_score, entry:entries(entry_number, team_name, team_members(member_position, full_name))')
        .lte('rank', 3).order('rank').limit(12);
      winners = (data ?? []).map((r) => {
        const e = (Array.isArray(r.entry) ? r.entry[0] : r.entry) as { entry_number: number; team_name: string | null; team_members: { member_position: number; full_name: string }[] } | null;
        return { rank: r.rank, entryNumber: e?.entry_number ?? null, teamName: e?.team_name ?? null,
          members: [...(e?.team_members ?? [])].sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name),
          score: finalPub.showScore === false ? null : Number(r.final_score) };
      });
    }
    return jsonOk({
      round: (round.data ?? []).find((r) => r.round_number === 1) ?? null,
      round2: (round.data ?? []).find((r) => r.round_number === 2) ?? null,
      announcements: announcements.data ?? [],
      twistRevealed: (twist.count ?? 0) > 0,
      winners,
      serverNow: new Date().toISOString(),
    });
  } catch (err) {
    return serverError('display stats', err, 'Could not load display data.');
  }
}
