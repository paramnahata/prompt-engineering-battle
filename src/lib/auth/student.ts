import 'server-only';
import { NextResponse } from 'next/server';
import { readSessionClaims, type SessionClaims } from '@/lib/auth/session';
import { jsonError } from '@/lib/http';

/**
 * Hot-path guard for student routes: verifies the signed cookie only. The
 * session id is then validated inside the same SQL function call that does
 * the work (student_round1_state / student_autosave / student_advance), so
 * a revoked or expired session is still rejected — in one round trip.
 */
export function studentClaims(): { ok: true; claims: SessionClaims } | { ok: false; response: NextResponse } {
  const claims = readSessionClaims();
  if (!claims) return { ok: false, response: jsonError('Sign in required.', 401) };
  if (claims.role !== 'student') return { ok: false, response: jsonError('Students only.', 403) };
  return { ok: true, claims };
}

/** Maps a `{ ok:false, status, code }` result from a student SQL function to an HTTP response. */
export function rpcFailure(data: { status?: number; code?: string } & Record<string, unknown>) {
  const messages: Record<string, string> = {
    session: 'Your session has ended. Please sign in again.',
    not_found: 'That challenge was not found.',
    forbidden: 'That challenge does not belong to your entry.',
    round_paused: 'Round 1 is paused. Your work is safe — wait for the organizer to resume.',
    round_ended: 'Round 1 has ended. Your answers have been submitted.',
    locked: 'This challenge is already locked.',
    expired: 'Time is up for this challenge.',
    not_started: 'This challenge has not started yet. Refresh the page.',
    timer_not_expired: 'This challenge timer has not finished yet.',
    word_limit: `Prompt exceeds the ${data.limit ?? ''}-word limit for this challenge.`,
    char_limit: `AI output exceeds the ${data.limit ?? ''}-character limit for this challenge.`,
  };
  const status = typeof data.status === 'number' ? data.status : 400;
  return jsonError(messages[data.code ?? ''] ?? 'Request failed.', status, { ...data, ok: false });
}
