import crypto from 'node:crypto';

/**
 * Rotating team PINs (organizer request, October 2026).
 *
 * Every entry has a 6-digit PIN that changes every 60 seconds. It is
 * derived on the server from a secret and the entry number, so nothing is
 * stored or printed: the registration desk reads the team its current PIN
 * from the organizer-only desk screen. A PIN from the previous minute is
 * still accepted for a short grace period so a team typing it at second 59
 * is not turned away.
 *
 * Other protections are unchanged: the entry must be checked in, only one
 * device per entry, 6 wrong attempts lock the entry for 10 minutes, and the
 * per-IP limit.
 */
export const TEAM_CODE_SECONDS = 60;
export const TEAM_CODE_GRACE_SECONDS = 30;

/** The secret the PINs are derived from: PIN_PEPPER if set (32+ chars), otherwise SESSION_SECRET. */
export function teamCodeKey(env: Record<string, string | undefined> = process.env): Buffer {
  const pepper = env.PIN_PEPPER;
  const base = pepper && pepper.length >= 32 ? pepper : env.SESSION_SECRET;
  if (!base || base.length < 32) throw new Error('SESSION_SECRET (or PIN_PEPPER) must be at least 32 characters.');
  return crypto.createHmac('sha256', base).update('peb:team-code:v1').digest();
}
const key = () => teamCodeKey();

export const teamCodeWindow = (nowMs: number) => Math.floor(nowMs / (TEAM_CODE_SECONDS * 1000));
const windowAt = teamCodeWindow;

export function teamCodeFor(entryNumber: number, windowIndex: number, k: Buffer = key()): string {
  const h = crypto.createHmac('sha256', k).update(`${entryNumber}:${windowIndex}`).digest();
  return (h.readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
}

/** Current PINs for the given entries and when they change (server time). */
export function currentTeamCodes(entryNumbers: number[], nowMs = Date.now()) {
  const w = windowAt(nowMs);
  const k = key();
  const codes: Record<number, string> = {};
  for (const n of entryNumbers) codes[n] = teamCodeFor(n, w, k);
  return { codes, changesAt: new Date((w + 1) * TEAM_CODE_SECONDS * 1000).toISOString(), serverNow: new Date(nowMs).toISOString(), periodSeconds: TEAM_CODE_SECONDS };
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

/** Accepts the current PIN, or the previous one within the grace period. */
export function isTeamCodeValid(entryNumber: number, input: string, nowMs = Date.now()): boolean {
  const pin = input.trim();
  if (!/^\d{6}$/.test(pin)) return false;
  const w = windowAt(nowMs);
  const k = key();
  let ok = safeEqual(pin, teamCodeFor(entryNumber, w, k));
  const intoWindowMs = nowMs - w * TEAM_CODE_SECONDS * 1000;
  if (intoWindowMs < TEAM_CODE_GRACE_SECONDS * 1000) ok = safeEqual(pin, teamCodeFor(entryNumber, w - 1, k)) || ok;
  return ok;
}
