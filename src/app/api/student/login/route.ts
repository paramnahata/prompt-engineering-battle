import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { isTeamCodeValid } from '@/lib/auth/team-code';
import { issueSessionCookie, readSessionClaims, SESSION_TTL_SECONDS } from '@/lib/auth/session';
import { parseEntryNumberInput } from '@/lib/entries';
import { clientIp, jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  entryCode: z.string().trim().min(1).max(20),
  pin: z.string().trim().min(1).max(12),
});

/** A device counts as "still in use" if it sent a heartbeat within this window. */
const ACTIVE_WINDOW_SECONDS = 60;

const MESSAGES: Record<string, string> = {
  rate_limited: 'Too many attempts for this entry. Wait 10 minutes, or ask the registration desk.',
  bad_credentials: 'Entry number or PIN is incorrect. The PIN changes every minute — ask the registration desk for the current one.',
  disqualified: 'This entry has been disqualified. Please see an organizer.',
  not_checked_in: 'Attendance not marked yet — please check in at the registration desk.',
  already_active: 'This entry is already signed in on another device. Close it there, or wait a minute and try again. The registration desk can also release it.',
};

/**
 * Student sign-in = entry number + the team's current PIN, which changes
 * every 60 seconds (src/lib/auth/team-code.ts) and is read to the team by
 * the registration desk. The entry must also be checked in, and only one
 * device per entry can be signed in (both enforced in student_login).
 * Order: rate-limit precheck → PIN checked server-side → one SQL call records
 * failures or opens the session. Unknown entries and wrong PINs are
 * indistinguishable. (The room code was removed, so p_code_ok is always true.)
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req, bodySchema, 4 * 1024);
  if (!body.ok) return body.response;

  const entryNumber = parseEntryNumberInput(body.data.entryCode);
  if (entryNumber === null) return jsonError('Enter your entry number, for example 7.', 400);

  try {
    const db = supabaseAdmin();
    const { data: pre, error: preErr } = await db.rpc('student_login_precheck', { p_entry_number: entryNumber, p_ip: clientIp(req) });
    if (preErr) throw preErr;
    if (!pre?.ok) return jsonError(MESSAGES[pre?.code] ?? 'Please try again shortly.', pre?.status ?? 429, { code: pre?.code });

    const pinOk = isTeamCodeValid(entryNumber, body.data.pin);
    const existing = readSessionClaims();

    const { data, error } = await db.rpc('student_login', {
      p_entry_number: entryNumber,
      p_code_ok: true,
      p_pin_ok: pinOk,
      p_user_agent: req.headers.get('user-agent') ?? '',
      p_existing_sid: existing?.role === 'student' ? existing.sid : null,
      p_ttl_seconds: SESSION_TTL_SECONDS,
      p_active_window_seconds: ACTIVE_WINDOW_SECONDS,
    });
    if (error) throw error;
    if (!data?.ok) {
      return jsonError(MESSAGES[data?.code] ?? 'Login failed. Please try again.', typeof data?.status === 'number' ? data.status : 400, { code: data?.code });
    }
    if (existing && existing.sid !== data.sid) {
      await db.from('auth_sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: 'replaced_on_device' })
        .eq('id', existing.sid).is('ended_at', null);
    }
    issueSessionCookie({ sid: data.sid, role: 'student', subjectId: data.entry_id, entryNumber: data.entry_number });
    return jsonOk({ ok: true, entryNumber: data.entry_number });
  } catch (err) {
    return serverError('student login', err, 'Login is temporarily unavailable. Please retry in a moment.');
  }
}
