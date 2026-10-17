import 'server-only';
import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Sessions are server-side rows in `auth_sessions`; the cookie carries an
 * HMAC-signed pointer to that row plus the claims needed to route requests.
 *
 * - Signature + expiry are verified on every read (cheap, no I/O).
 * - Protected requests then validate the row (`auth_session_validate`),
 *   which also re-checks the account still exists with the same role, so
 *   logout, password reset, account deletion, demotion and disqualification
 *   take effect immediately — the cookie alone is never enough.
 * - Student hot paths (state/autosave/advance) pass the session id into a
 *   single SQL function that validates it in the same round trip.
 */

import {
  decodeSessionToken, encodeSessionToken, secureCookies, sessionCookieName, SESSION_TTL_SECONDS,
  type Role, type SessionClaims,
} from '@/lib/auth/token';

export { ORGANIZER_ROLES, SESSION_TTL_SECONDS, type Role, type SessionClaims } from '@/lib/auth/token';

export interface Session {
  sid: string;
  role: Role;
  userId: string;
  entryId: string | null;
  entryNumber: number | null;
}

/** Signature-only read of the cookie. Use only where the session id is validated downstream. */
export function readSessionClaims(): SessionClaims | null {
  return decodeSessionToken(cookies().get(sessionCookieName())?.value);
}

function setSessionCookie(claims: SessionClaims) {
  cookies().set(sessionCookieName(), encodeSessionToken(claims), {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: claims.exp - claims.iat,
  });
}

export function clearSessionCookie() {
  cookies().set(sessionCookieName(), '', {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

/** Issues a cookie for a session row that already exists (students: created by student_login). */
export function issueSessionCookie(input: { sid: string; role: Role; subjectId: string; entryNumber?: number }) {
  const iat = Math.floor(Date.now() / 1000);
  setSessionCookie({
    v: 2,
    sid: input.sid,
    role: input.role,
    sub: input.subjectId,
    en: input.entryNumber,
    iat,
    exp: iat + SESSION_TTL_SECONDS,
  });
}

/** Creates a fresh organizer session row + cookie (always a new id: no session fixation). */
export async function createOrganizerSession(role: Exclude<Role, 'student'>, subjectId: string) {
  const db = supabaseAdmin();
  const userAgent = headers().get('user-agent')?.slice(0, 200) ?? null;
  const { data, error } = await db
    .from('auth_sessions')
    .insert({
      role,
      subject_id: subjectId,
      expires_at: new Date(Date.now() + SESSION_TTL_SECONDS * 1000).toISOString(),
      user_agent: userAgent,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error('Could not create session');
  issueSessionCookie({ sid: data.id, role, subjectId });
}

/** Ends the current session server-side and clears the cookie. */
export async function destroySession() {
  const claims = readSessionClaims();
  if (claims) {
    await supabaseAdmin()
      .from('auth_sessions')
      .update({ ended_at: new Date().toISOString(), end_reason: 'logout' })
      .eq('id', claims.sid)
      .is('ended_at', null);
  }
  clearSessionCookie();
}

/** Ends every live session for an account (password reset, deletion, release). */
export async function endSessionsForSubject(subjectId: string, reason: string) {
  await supabaseAdmin()
    .from('auth_sessions')
    .update({ ended_at: new Date().toISOString(), end_reason: reason })
    .eq('subject_id', subjectId)
    .is('ended_at', null);
}

/** Full validation: signature + live session row + account still valid for that role. */
export async function getSession(options: { touch?: boolean; visible?: boolean } = {}): Promise<Session | null> {
  const claims = readSessionClaims();
  if (!claims) return null;
  const { data, error } = await supabaseAdmin().rpc('auth_session_validate', {
    p_sid: claims.sid,
    p_touch: options.touch ?? true,
    p_visible: options.visible ?? null,
  });
  if (error || !data || data.valid !== true) return null;
  if (data.role !== claims.role || data.subject_id !== claims.sub) return null;
  return {
    sid: claims.sid,
    role: claims.role,
    userId: claims.sub,
    entryId: data.entry_id ?? null,
    entryNumber: data.entry_number ?? claims.en ?? null,
  };
}

export type ApiAuth = { ok: true; session: Session } | { ok: false; response: NextResponse };

/** Route-handler guard: 401 when not signed in, 403 when signed in with the wrong role. */
export async function requireApiRole(roles: readonly Role[]): Promise<ApiAuth> {
  const session = await getSession();
  if (!session) {
    return { ok: false, response: NextResponse.json({ error: 'Sign in required.' }, { status: 401, headers: { 'Cache-Control': 'no-store' } }) };
  }
  if (!roles.includes(session.role)) {
    return { ok: false, response: NextResponse.json({ error: 'You do not have access to this action.' }, { status: 403, headers: { 'Cache-Control': 'no-store' } }) };
  }
  return { ok: true, session };
}

/** Page guard for server components: redirects to the right login when access is missing. */
export async function requirePageRole(roles: readonly Role[], nextPath: string): Promise<Session> {
  const session = await getSession();
  if (session && roles.includes(session.role)) return session;
  if (roles.includes('student') && roles.length === 1) redirect('/student/login');
  redirect(`/organizer/login?next=${encodeURIComponent(nextPath)}`);
}

/** Where a signed-in user belongs. */
export function homeForRole(role: Role): string {
  switch (role) {
    case 'admin': return '/admin/dashboard';
    case 'volunteer': return '/admin/attendance';
    case 'judge': return '/judge/dashboard';
    case 'student': return '/student/waiting';
  }
}
