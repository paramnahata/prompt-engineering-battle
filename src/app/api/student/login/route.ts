import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { isAccessCodeValid } from '@/lib/security/access-code';
import { issueSessionCookie, readSessionClaims, SESSION_TTL_SECONDS } from '@/lib/auth/session';
import { parseEntryNumberInput } from '@/lib/entries';
import { clientIp, jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  entryCode: z.string().trim().min(1).max(20),
  accessCode: z.string().trim().min(1).max(10),
});

/** A device is considered "still in use" if it sent a heartbeat within this window. */
const ACTIVE_WINDOW_SECONDS = 60;

const MESSAGES: Record<string, string> = {
  rate_limited: 'Too many attempts. Wait a few minutes, then try again or ask the registration desk.',
  bad_access_code: 'Access code is incorrect or has expired. Use the code currently on the screen.',
  not_found: 'Entry number not found. Check the number given at the registration desk.',
  disqualified: 'This entry has been disqualified. Please see an organizer.',
  not_checked_in: 'Attendance not marked yet — please check in at the registration desk.',
  already_active: 'This entry is already signed in on another device. Close it there, or wait a minute and try again. The registration desk can also release it.',
};

export async function POST(req: NextRequest) {
  const body = await readJson(req, bodySchema, 4 * 1024);
  if (!body.ok) return body.response;

  const entryNumber = parseEntryNumberInput(body.data.entryCode);
  if (entryNumber === null) return jsonError('Enter your entry number, for example 7.', 400);

  const codeOk = isAccessCodeValid(body.data.accessCode);
  const existing = readSessionClaims();

  try {
    const { data, error } = await supabaseAdmin().rpc('student_login', {
      p_entry_number: entryNumber,
      p_code_ok: codeOk,
      p_ip: clientIp(req),
      p_user_agent: req.headers.get('user-agent') ?? '',
      p_existing_sid: existing?.role === 'student' ? existing.sid : null,
      p_ttl_seconds: SESSION_TTL_SECONDS,
      p_active_window_seconds: ACTIVE_WINDOW_SECONDS,
    });
    if (error) throw error;
    if (!data?.ok) {
      const status = typeof data?.status === 'number' ? data.status : 400;
      return jsonError(MESSAGES[data?.code] ?? 'Login failed. Please try again.', status, { code: data?.code });
    }
    if (existing && existing.sid !== data.sid) {
      // This browser was signed in as someone else — end that session server-side.
      await supabaseAdmin().from('auth_sessions')
        .update({ ended_at: new Date().toISOString(), end_reason: 'replaced_on_device' })
        .eq('id', existing.sid).is('ended_at', null);
    }
    issueSessionCookie({ sid: data.sid, role: 'student', subjectId: data.entry_id, entryNumber: data.entry_number });
    return jsonOk({ ok: true, entryNumber: data.entry_number });
  } catch (err) {
    return serverError('student login', err, 'Login is temporarily unavailable. Please retry in a moment.');
  }
}
