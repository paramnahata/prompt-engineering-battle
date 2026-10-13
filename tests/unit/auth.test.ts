import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

before(() => {
  process.env.SESSION_SECRET = 'test-secret-'.padEnd(48, 'x');
  process.env.EVENT_SECRET = 'event-secret-for-tests';
});

const claims = (over: Record<string, unknown> = {}) => {
  const iat = Math.floor(Date.now() / 1000);
  return { v: 2, sid: crypto.randomUUID(), role: 'student', sub: crypto.randomUUID(), en: 7, iat, exp: iat + 3600, ...over };
};

test('session tokens round-trip and reject tampering', async () => {
  const { encodeSessionToken, decodeSessionToken } = await import('@/lib/auth/token');
  const c = claims();
  const token = encodeSessionToken(c as never);
  assert.deepEqual(decodeSessionToken(token), c);

  const [body, sig] = token.split('.');
  const forged = Buffer.from(JSON.stringify({ ...c, role: 'admin' })).toString('base64url');
  assert.equal(decodeSessionToken(`${forged}.${sig}`), null, 'role escalation by editing payload');
  assert.equal(decodeSessionToken(`${body}.${sig!.slice(0, -2)}AA`), null, 'bad signature');
  assert.equal(decodeSessionToken(`${body}`), null);
  assert.equal(decodeSessionToken(''), null);
  assert.equal(decodeSessionToken('a.b.c'), null);
  assert.equal(decodeSessionToken('x'.repeat(5000)), null);
});

test('session tokens enforce structure, role whitelist and expiry', async () => {
  const { encodeSessionToken, decodeSessionToken } = await import('@/lib/auth/token');
  const now = Math.floor(Date.now() / 1000);
  const cases: Record<string, unknown>[] = [
    { role: 'superadmin' },
    { role: 'Admin' },
    { sid: 'not-a-uuid' },
    { sub: "1' or 1=1--" },
    { v: 1 },
    { exp: now - 1 },
    { iat: now + 3600, exp: now + 7200 },
    { exp: now + 60 * 60 * 24 * 30 },
    { en: 'seven' },
  ];
  for (const over of cases) {
    assert.equal(decodeSessionToken(encodeSessionToken(claims(over) as never)), null, JSON.stringify(over));
  }
  const expired = encodeSessionToken(claims() as never);
  assert.equal(decodeSessionToken(expired, Date.now() + 2 * 3600 * 1000), null);
});

test('tokens signed with another secret are rejected', async () => {
  const { encodeSessionToken, decodeSessionToken } = await import('@/lib/auth/token');
  const token = encodeSessionToken(claims() as never);
  process.env.SESSION_SECRET = 'a-different-secret-'.padEnd(48, 'y');
  try {
    assert.equal(decodeSessionToken(token), null);
  } finally {
    process.env.SESSION_SECRET = 'test-secret-'.padEnd(48, 'x');
  }
});

test('access code: current window valid, previous only within grace, malformed rejected', async () => {
  const { getCurrentAccessCode, isAccessCodeValid, ROTATE_SECONDS, GRACE_SECONDS } = await import('@/lib/security/access-code');
  const windowStart = Math.floor(Date.now() / (ROTATE_SECONDS * 1000)) * ROTATE_SECONDS * 1000;
  const prev = getCurrentAccessCode(windowStart - 1000).code;
  const cur = getCurrentAccessCode(windowStart + 1000).code;
  assert.ok(isAccessCodeValid(cur, windowStart + 1000));
  assert.ok(isAccessCodeValid(` ${cur} `, windowStart + 1000));
  if (prev !== cur) {
    assert.ok(isAccessCodeValid(prev, windowStart + (GRACE_SECONDS - 1) * 1000), 'grace period');
    assert.ok(!isAccessCodeValid(prev, windowStart + (GRACE_SECONDS + 1) * 1000), 'expired after grace');
  }
  for (const bad of ['', '123', '12345', 'abcd', '12a4']) assert.ok(!isAccessCodeValid(bad), bad);
});

test('safeNextPath blocks open redirects', async () => {
  const { safeNextPath } = await import('@/lib/http');
  const fb = '/organizer/hub';
  assert.equal(safeNextPath('/admin/dashboard'), '/admin/dashboard');
  assert.equal(safeNextPath('/admin/entries?x=1'), '/admin/entries?x=1');
  for (const bad of ['https://evil.com', '//evil.com', '/\\evil.com', '\\\\evil.com', '/%0d%0aSet-Cookie:x', 'javascript:alert(1)', '/\tevil', '', null, undefined]) {
    const out = safeNextPath(bad as string, fb);
    assert.ok(out === fb || (out.startsWith('/') && !out.startsWith('//')), String(bad));
    assert.ok(!out.includes('evil.com') || out.startsWith('/%'), String(bad));
  }
  assert.equal(safeNextPath('/\\evil.com', fb), fb);
  assert.equal(safeNextPath('//evil.com', fb), fb);
});

test('entry numbers: display and student input parsing', async () => {
  const { formatEntryNumber, parseEntryNumberInput } = await import('@/lib/entries');
  assert.equal(formatEntryNumber({ entry_number: 7 }), '7');
  assert.equal(formatEntryNumber({ entry_code: 'ENTRY-007' }), '7');
  assert.equal(formatEntryNumber({ entry_code: 'ENTRY-120' }), '120');
  for (const [input, n] of [['7', 7], [' 07 ', 7], ['#7', 7], ['ENTRY-007', 7], ['entry 15', 15], ['200', 200]] as const) {
    assert.equal(parseEntryNumberInput(input), n, input);
  }
  for (const bad of ['', '0', '-1', '1.5', 'abc', '7 or 1=1', '123456', "1'--"]) assert.equal(parseEntryNumberInput(bad), null, bad);
});
