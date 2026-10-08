import { cookies } from 'next/headers';
import crypto from 'node:crypto';

export type Role = 'admin' | 'volunteer' | 'judge' | 'student';

export interface SessionPayload {
  role: Role;
  userId: string; // admins.id, judges.id, or entries.id
  entryCode?: string; // students only, for convenience/display
  issuedAt: number;
}

const COOKIE_NAME = 'peb_session';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h — plenty for one event day

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Missing SESSION_SECRET environment variable.');
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
}

/** Creates a signed, HTTP-only session cookie. Call from a route handler / server action. */
export function createSession(payload: SessionPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = sign(body);
  const token = `${body}.${sig}`;

  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
}

export function destroySession() {
  cookies().delete(COOKIE_NAME);
}

/** Reads + verifies the session cookie. Returns null if missing/invalid/expired. */
export function getSession(): SessionPayload | null {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;

  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  if (sign(body) !== sig) return null; // tampered

  try {
    const payload: SessionPayload = JSON.parse(
      Buffer.from(body, 'base64url').toString('utf-8')
    );
    if (Date.now() - payload.issuedAt > MAX_AGE_SECONDS * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

/** Throws-style guard for route handlers: returns the session or a 401 marker. */
export function requireRole(role: Role): SessionPayload | null {
  const session = getSession();
  if (!session || session.role !== role) return null;
  return session;
}

/** Like requireRole, but accepts any of several roles (e.g. admin OR volunteer). */
export function requireAnyRole(roles: Role[]): SessionPayload | null {
  const session = getSession();
  if (!session || !roles.includes(session.role)) return null;
  return session;
}
