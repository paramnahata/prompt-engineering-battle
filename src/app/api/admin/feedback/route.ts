import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';
import { isMissingTable } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

type Row = {
  overall_rating: number; system_rating: number; management_rating: number; challenge_level: string; join_again: string;
  liked: string; suggestions: string | null; submitted_at: string;
  entry: { entry_number: number; team_name: string | null; team_members: { member_position: number; full_name: string }[] } | null;
};

/** All Round 1 feedback, newest first, plus averages. Admin only. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('round1_feedback')
      .select('overall_rating, system_rating, management_rating, challenge_level, join_again, liked, suggestions, submitted_at, entry:entries(entry_number, team_name, team_members(member_position, full_name))')
      .order('submitted_at', { ascending: false }).limit(5000);
    if (error) {
      if (isMissingTable(error)) return jsonOk({ available: false, rows: [], summary: null });
      throw error;
    }
    const rows = ((data ?? []) as unknown as Row[]).map((f) => {
      type Entry = NonNullable<Row['entry']>;
      const e: Entry | null = (Array.isArray(f.entry) ? (f.entry as Entry[])[0] : f.entry) ?? null;
      return {
        entryNumber: e?.entry_number ?? null, teamName: e?.team_name ?? null,
        members: [...(e?.team_members ?? [])].sort((a, b) => a.member_position - b.member_position).map((m) => m.full_name),
        overall: f.overall_rating, system: f.system_rating, management: f.management_rating,
        challengeLevel: f.challenge_level, joinAgain: f.join_again, liked: f.liked, suggestions: f.suggestions, submittedAt: f.submitted_at,
      };
    });
    const avg = (k: 'overall' | 'system' | 'management') => (rows.length ? Math.round((rows.reduce((a, r) => a + r[k], 0) / rows.length) * 10) / 10 : null);
    const { count } = await db.from('entries').select('id', { count: 'exact', head: true }).eq('present', true);
    return jsonOk({ available: true, rows, summary: { responses: rows.length, checkedIn: count ?? 0, overall: avg('overall'), system: avg('system'), management: avg('management') } });
  } catch (err) {
    return serverError('admin feedback', err, 'Could not load feedback.');
  }
}
