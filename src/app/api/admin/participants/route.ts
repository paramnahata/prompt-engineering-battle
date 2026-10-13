import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const MEMBER_COLUMNS = 'member_position, full_name, email, phone, gender, college, city, branch, study_year';

/**
 * Participant list for the registration desk. ~200 entries is small enough
 * to send once and filter instantly in the browser (no per-keystroke
 * requests, no stale-response races).
 */
export async function GET() {
  const auth = await requireApiRole(['admin', 'volunteer']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin()
      .from('entries')
      .select(`id, entry_number, registration_id, team_name, is_team, present, present_at, disqualified, team_members(${MEMBER_COLUMNS})`)
      .order('entry_number', { ascending: true })
      .limit(2000);
    if (error) throw error;
    return jsonOk({ entries: data ?? [] });
  } catch (err) {
    return serverError('participants list', err, 'Could not load participants.');
  }
}

const deleteSchema = z.object({ confirm: z.literal('DELETE ALL PARTICIPANTS') });

/**
 * Removes every participant so a corrected sheet can be imported. Refused
 * once Round 1 has assignments — competition data must be reset first
 * (Start Over), so this can never silently erase submissions.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 1024);
  if (!body.ok) return jsonError('Type DELETE ALL PARTICIPANTS to confirm.', 400);
  try {
    const db = supabaseAdmin();
    const [{ count: assignments, error: aErr }, { data: round, error: rErr }] = await Promise.all([
      db.from('challenge_assignments').select('id', { count: 'exact', head: true }),
      db.from('rounds').select('status').eq('round_number', 1).maybeSingle(),
    ]);
    if (aErr || rErr) throw aErr ?? rErr;
    if ((assignments ?? 0) > 0 || (round && round.status !== 'not_started')) {
      return jsonError('Round 1 has data. Use Start Over on the dashboard first; participants can only be cleared before the competition starts.', 409);
    }
    const { error, count } = await db.from('entries').delete({ count: 'exact' }).not('id', 'is', null);
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'reset_participants', old_value: { deleted_count: count } });
    return jsonOk({ ok: true, deleted: count ?? 0 });
  } catch (err) {
    return serverError('participants reset', err, 'Could not clear participants.');
  }
}
