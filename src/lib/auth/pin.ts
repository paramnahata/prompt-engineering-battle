import crypto from 'node:crypto';

/**
 * Team PINs (6 digits). Stored as scrypt(HMAC(pepper, pin), per-entry salt).
 * The pepper lives in the environment (PIN_PEPPER, or derived from
 * SESSION_SECRET), so a database leak alone is not enough to brute-force
 * the small PIN space offline. Online guessing is limited to 6 failures
 * per entry per 10 minutes (see student_login).
 */

/**
 * scrypt cost by hash version. s2 (N=4096, ~10 ms) is the default: the pepper,
 * not the KDF cost, is what protects a 6-digit space against offline attack,
 * and a 200-team login burst must not queue seconds of CPU on one instance.
 * s1 (N=16384) hashes are still verified.
 */
const PARAMS = {
  s1: { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 },
  s2: { N: 1 << 12, r: 8, p: 1, maxmem: 32 * 1024 * 1024 },
} as const;
type Version = keyof typeof PARAMS;
const CURRENT: Version = 's2';
const KEYLEN = 32;
export const PIN_LENGTH = 6;

function pepper(): Buffer {
  const explicit = process.env.PIN_PEPPER;
  if (explicit && explicit.length >= 32) return Buffer.from(explicit);
  const session = process.env.SESSION_SECRET;
  if (!session || session.length < 32) throw new Error('PIN_PEPPER (or SESSION_SECRET) must be at least 32 characters.');
  return crypto.createHmac('sha256', session).update('peb:pin-pepper:v1').digest();
}

function scrypt(input: Buffer, salt: Buffer, version: Version): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    crypto.scrypt(input, salt, KEYLEN, PARAMS[version], (err, key) => (err ? reject(err) : resolve(key))));
}

const WEAK = new Set(['000000', '111111', '222222', '333333', '444444', '555555', '666666', '777777', '888888', '999999',
  '123456', '654321', '012345', '543210', '123123', '112233', '121212']);

/** Uniformly random 6-digit PIN, avoiding the most guessable patterns. */
export function generatePin(): string {
  for (;;) {
    const pin = crypto.randomInt(0, 10 ** PIN_LENGTH).toString().padStart(PIN_LENGTH, '0');
    if (!WEAK.has(pin) && !/^(\d)\1{4,}/.test(pin)) return pin;
  }
}

export function isPinFormat(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_LENGTH}}$`).test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  if (!isPinFormat(pin)) throw new Error('PIN must be 6 digits');
  const salt = crypto.randomBytes(16);
  const key = await scrypt(crypto.createHmac('sha256', pepper()).update(pin).digest(), salt, CURRENT);
  return `${CURRENT}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

/** Constant-time verify. Always does the same work, even for a missing hash. */
export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
  const parts = (stored ?? '').split('$');
  const valid = parts.length === 3 && (parts[0] === 's1' || parts[0] === 's2');
  const version: Version = valid ? (parts[0] as Version) : CURRENT;
  const salt = valid ? Buffer.from(parts[1]!, 'base64url') : crypto.randomBytes(16);
  const expected = valid ? Buffer.from(parts[2]!, 'base64url') : crypto.randomBytes(KEYLEN);
  const key = await scrypt(crypto.createHmac('sha256', pepper()).update(isPinFormat(pin) ? pin : 'invalid').digest(), salt, version);
  return valid && isPinFormat(pin) && expected.length === key.length && crypto.timingSafeEqual(expected, key);
}
