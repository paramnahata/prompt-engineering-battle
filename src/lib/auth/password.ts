import crypto from 'node:crypto';

/** scrypt-based password hashing — no external dependency needed. */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, derivedHex] = stored.split(':');
  if (!salt || !derivedHex) return false;
  const derived = crypto.scryptSync(password, salt, 64);
  const stored_ = Buffer.from(derivedHex, 'hex');
  if (derived.length !== stored_.length) return false;
  return crypto.timingSafeEqual(derived, stored_);
}
