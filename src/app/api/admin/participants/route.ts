import crypto from 'node:crypto';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { entryPayloadSchema } from '@/lib/participants';

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
      .select(`id, entry_number, registration_id, team_name, is_team, present, present_at, disqualified, disqualified_reason, pin_set_at, team_members(${MEMBER_COLUMNS})`)
      .order('entry_number', { ascending: true })
      .limit(2000);
    if (error) throw error;
    return jsonOk({ entries: data ?? [] });
  } catch (err) {
    return serverError('participants list', err, 'Could not load participants.');
  }
}

/** Manual registration (admin). Uses the same atomic import function as the CSV path. */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, entryPayloadSchema, 8 * 1024);
  if (!body.ok) return body.response;
  try {
    const payload = [{
      registration_id: `MANUAL-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      team_name: body.data.team_name ?? '',
      members: body.data.members.map((m, i) => ({
        position: i + 1, full_name: m.full_name, email: (m.email ?? '').toLowerCase(), phone: (m.phone ?? '').replace(/[^\d+]/g, ''),
        gender: m.gender ?? '', college: m.college ?? '', city: m.city ?? '', branch: m.branch ?? '', study_year: m.study_year ?? '', source_row: null,
      })),
    }];
    const { data, error } = await supabaseAdmin().rpc('import_participants', { p_entries: payload, p_admin: auth.session.userId });
    if (error) throw error;
    return jsonOk({ ok: true, entryNumber: data?.firstEntryNumber });
  } catch (err) {
    return serverError('create entry', err, 'Could not create the entry.');
  }
}

const deleteSchema = z.object({ confirm: z.string().max(40) });

/**
 * Removes every participant so a corrected sheet can be imported. The SQL
 * function locks the rounds first, so it can't race a round start, and it
 * refuses once any competition data exists.
 */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('clear_participants', { p_admin: auth.session.userId, p_confirm: body.data.confirm });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Not allowed.', data?.status ?? 409, { code: data?.code });
    return jsonOk({ ok: true, deleted: data.deleted });
  } catch (err) {
    return serverError('participants reset', err, 'Could not clear participants.');
  }
}
