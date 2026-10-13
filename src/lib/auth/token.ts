import crypto from 'node:crypto';

/** Pure, I/O-free session token encoding/verification (unit-tested). */

export type Role = 'admin' | 'volunteer' | 'judge' | 'student';
export const ORGANIZER_ROLES: readonly Role[] = ['admin', 'volunteer', 'judge'];
const ALL_ROLES: readonly Role[] = ['admin', 'volunteer', 'judge', 'student'];

export interface SessionClaims {
  v: 2;
  sid: string;
  role: Role;
  sub: string; // admins.id, judges.id or entries.id
  en?: number; // student entry number (display only)
  iat: number;
  exp: number;
}

export const SESSION_TTL_SECONDS = 60 * 60 * 12;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sessionCookieName(): string {
  return process.env.NODE_ENV === 'production' ? '__Host-peb_session' : 'peb_session';
}

function getSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET must be set to a random value of at least 32 characters.');
  return secret;
}

function sign(body: string): Buffer {
  return crypto.createHmac('sha256', getSecret()).update(body).digest();
}

export function encodeSessionToken(claims: SessionClaims): string {
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${body}.${sign(body).toString('base64url')}`;
}

/** Verifies signature, structure and expiry. Pure — exported for tests. */
export function decodeSessionToken(token: string | undefined | null, nowMs = Date.now()): SessionClaims | null {
  if (!token || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  let received: Buffer;
  try {
    received = Buffer.from(sig, 'base64url');
  } catch {
    return null;
  }
  const expected = sign(body);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const c = raw as Record<string, unknown>;
  if (c.v !== 2) return null;
  if (typeof c.sid !== 'string' || !UUID_RE.test(c.sid)) return null;
  if (typeof c.sub !== 'string' || !UUID_RE.test(c.sub)) return null;
  if (typeof c.role !== 'string' || !(ALL_ROLES as readonly string[]).includes(c.role)) return null;
  if (typeof c.iat !== 'number' || typeof c.exp !== 'number' || !Number.isFinite(c.iat) || !Number.isFinite(c.exp)) return null;
  if (c.en !== undefined && (typeof c.en !== 'number' || !Number.isInteger(c.en))) return null;
  const nowSec = Math.floor(nowMs / 1000);
  if (c.iat > nowSec + 300 || c.exp <= nowSec || c.exp - c.iat > SESSION_TTL_SECONDS) return null;
  return c as unknown as SessionClaims;
}

