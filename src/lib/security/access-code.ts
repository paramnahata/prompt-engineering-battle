import crypto from 'node:crypto';

/**
 * Rotating 4-digit event access code, derived from EVENT_SECRET and the
 * current 2-minute window (server clock). It proves physical presence: it
 * is shown only on organizer-authenticated screens (projector / desk), and
 * the endpoint that serves it requires an organizer session.
 *
 * The code alone is NOT the security boundary: student login is also
 * rate-limited per IP and per entry, requires the entry to be checked in by
 * a volunteer, and allows only one live device per entry.
 */

export const ROTATE_SECONDS = 120;
/** A code typed just before rotation is still accepted for this long. */
export const GRACE_SECONDS = 20;

function deriveCode(windowIndex: number): string {
  const secret = process.env.EVENT_SECRET;
  if (!secret) throw new Error('Missing EVENT_SECRET environment variable.');
  const h = crypto.createHmac('sha256', secret).update(String(windowIndex)).digest('hex');
  const num = parseInt(h.slice(0, 8), 16) % 10_000;
  return num.toString().padStart(4, '0');
}

function windowIndexAt(nowMs: number): number {
  return Math.floor(nowMs / (ROTATE_SECONDS * 1000));
}

export function getCurrentAccessCode(nowMs = Date.now()) {
  const windowIndex = windowIndexAt(nowMs);
  return { code: deriveCode(windowIndex), rotatesAt: (windowIndex + 1) * ROTATE_SECONDS * 1000, serverNow: nowMs };
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function isAccessCodeValid(submitted: string, nowMs = Date.now()): boolean {
  const code = submitted.trim();
  if (!/^\d{4}$/.test(code)) return false;
  const current = windowIndexAt(nowMs);
  if (safeEqual(code, deriveCode(current))) return true;
  const intoWindowMs = nowMs - current * ROTATE_SECONDS * 1000;
  return intoWindowMs < GRACE_SECONDS * 1000 && safeEqual(code, deriveCode(current - 1));
}
