import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Actor, accessCode, loadStackEnv, signToken, COOKIE } from './client';

/**
 * Endpoint-by-endpoint authorization tests against the local staging stack
 * (tests/stack/start.sh). Synthetic data only.
 */
const env = loadStackEnv();
const PASSWORD = 'Staging-Only-Password-1';

const anon = new Actor('no session');
const student = new Actor('student');
const student2 = new Actor('student 2');
const volunteer = new Actor('volunteer');
const judge = new Actor('judge');
const admin = new Actor('admin');
const expired = new Actor('expired session');
const tampered = new Actor('tampered session');
const badRole = new Actor('invalid role');
const revoked = new Actor('revoked session');

type Role = 'student' | 'volunteer' | 'judge' | 'admin';
const NIL = '00000000-0000-0000-0000-000000000000';
const ENDPOINTS: { method: string; path: string; body?: unknown; allow: Role[] }[] = [
  { method: 'GET', path: '/api/access-code', allow: ['volunteer', 'judge', 'admin'] },
  { method: 'GET', path: '/api/display/stats', allow: ['volunteer', 'judge', 'admin'] },
  { method: 'GET', path: '/api/admin/participants', allow: ['volunteer', 'admin'] },
  { method: 'DELETE', path: '/api/admin/participants', body: { confirm: 'nope' }, allow: ['admin'] },
  { method: 'POST', path: '/api/admin/participants/import', body: { csvText: 'NAMES\nA\n', mode: 'preview' }, allow: ['admin'] },
  { method: 'POST', path: '/api/admin/attendance', body: { entryId: NIL, present: true }, allow: ['volunteer', 'admin'] },
  { method: 'GET', path: '/api/admin/student-logins', allow: ['volunteer', 'admin'] },
  { method: 'POST', path: '/api/admin/sessions/release', body: { entryId: NIL }, allow: ['volunteer', 'admin'] },
  { method: 'GET', path: '/api/admin/round1/status', allow: ['admin'] },
  { method: 'POST', path: '/api/admin/round1/control', body: { action: 'resume' }, allow: ['admin'] },
  { method: 'GET', path: '/api/admin/challenges', allow: ['admin'] },
  { method: 'PATCH', path: '/api/admin/challenges', body: { action: 'set_active', ids: [NIL], active: true }, allow: ['admin'] },
  { method: 'GET', path: '/api/admin/evaluations', allow: ['admin'] },
  { method: 'POST', path: '/api/admin/evaluations', body: { action: 'retry_failed' }, allow: ['admin'] },
  { method: 'GET', path: '/api/admin/results', allow: ['admin'] },
  { method: 'POST', path: '/api/admin/results', body: { qualificationPercent: 15 }, allow: ['admin'] },
  { method: 'GET', path: `/api/admin/entries/${NIL}/round1`, allow: ['admin'] },
  { method: 'PATCH', path: `/api/admin/entries/${NIL}/round1`, body: { submissionId: NIL, newTotal: 10, reason: 'test' }, allow: ['admin'] },
  { method: 'GET', path: '/api/admin/users', allow: ['admin'] },
  { method: 'POST', path: '/api/admin/users', body: { kind: 'admin', email: 'x', full_name: '', password: '' }, allow: ['admin'] },
  { method: 'PATCH', path: '/api/admin/users', body: { kind: 'admin', id: NIL, newPassword: 'x' }, allow: ['admin'] },
  { method: 'DELETE', path: '/api/admin/users', body: { kind: 'judge', id: NIL }, allow: ['admin'] },
  { method: 'GET', path: '/api/admin/ai-settings', allow: ['admin'] },
  { method: 'POST', path: '/api/admin/ai-settings', body: { apiKey: 'short' }, allow: ['admin'] },
  { method: 'DELETE', path: '/api/admin/ai-settings', allow: ['admin'] },
  { method: 'GET', path: '/api/student/round1/state', allow: ['student'] },
  { method: 'POST', path: '/api/student/round1/autosave', body: { submissionId: NIL, promptText: '', aiOutputText: '' }, allow: ['student'] },
  { method: 'POST', path: '/api/student/round1/advance', body: { submissionId: NIL }, allow: ['student'] },
  { method: 'POST', path: '/api/student/heartbeat', body: { visible: true }, allow: ['student'] },
  { method: 'GET', path: '/api/student/waiting/state', allow: ['student'] },
  { method: 'POST', path: '/api/student/log', body: { event_type: 'tab_hidden' }, allow: ['student'] },
];

async function orgLogin(a: Actor, email: string) {
  const r = await a.req('POST', '/api/organizer/login', { email, password: PASSWORD });
  assert.equal(r.status, 200, `${email} login: ${JSON.stringify(r.json)}`);
}

before(async () => {
  await orgLogin(admin, 'admin@staging.local');
  await orgLogin(volunteer, 'desk@staging.local');
  await orgLogin(judge, 'judge@staging.local');
  const code = accessCode(env.EVENT_SECRET!);
  const s1 = await student.req('POST', '/api/student/login', { entryCode: '201', accessCode: code });
  assert.equal(s1.status, 200, JSON.stringify(s1.json));
  const s2 = await student2.req('POST', '/api/student/login', { entryCode: '202', accessCode: code });
  assert.equal(s2.status, 200, JSON.stringify(s2.json));

  const raw = decodeURIComponent(student.cookie!.split('=').slice(1).join('='));
  const claims = JSON.parse(Buffer.from(raw.split('.')[0]!, 'base64url').toString());
  const now = Math.floor(Date.now() / 1000);
  expired.cookie = `${COOKIE}=${signToken(env.SESSION_SECRET!, { ...claims, iat: now - 50000, exp: now - 10 })}`;
  const forgedBody = Buffer.from(JSON.stringify({ ...claims, role: 'admin' })).toString('base64url');
  tampered.cookie = `${COOKIE}=${forgedBody}.${raw.split('.')[1]}`;
  badRole.cookie = `${COOKIE}=${signToken(env.SESSION_SECRET!, { ...claims, role: 'superadmin' })}`;
  // Correctly signed, but the session row does not exist (e.g. revoked / forged with a leaked secret but no DB row).
  revoked.cookie = `${COOKIE}=${signToken(env.SESSION_SECRET!, { ...claims, sid: crypto.randomUUID(), role: 'admin' })}`;
});

const ACTORS = () => ({ student, volunteer, judge, admin } as Record<Role, Actor>);

test('every protected endpoint rejects missing, expired, tampered, invalid-role and revoked sessions with 401', async () => {
  for (const ep of ENDPOINTS) {
    for (const a of [anon, expired, tampered, badRole]) {
      const r = await a.req(ep.method, ep.path, ep.body);
      assert.equal(r.status, 401, `${a.name} → ${ep.method} ${ep.path} gave ${r.status}`);
    }
    const r = await revoked.req(ep.method, ep.path, ep.body);
    assert.ok(r.status === 401 || r.status === 403, `revoked → ${ep.method} ${ep.path} gave ${r.status}`);
  }
});

test('role matrix: wrong roles get 403, allowed roles get past authorization', async () => {
  for (const ep of ENDPOINTS) {
    for (const [role, actor] of Object.entries(ACTORS()) as [Role, Actor][]) {
      const r = await actor.req(ep.method, ep.path, ep.body);
      if (ep.allow.includes(role)) {
        assert.ok(r.status !== 401 && r.status !== 403, `${role} should be allowed: ${ep.method} ${ep.path} gave ${r.status} ${JSON.stringify(r.json)}`);
      } else {
        assert.equal(r.status, 403, `${role} must be forbidden: ${ep.method} ${ep.path} gave ${r.status}`);
      }
    }
  }
});

test('students cannot touch another entry\'s submission (IDOR)', async () => {
  const start = await admin.req('POST', '/api/admin/round1/control', { action: 'start' });
  assert.ok(start.status === 200 || start.json.code === 'bad_state', JSON.stringify(start.json));
  const s2 = await student2.req('GET', '/api/student/round1/state');
  assert.equal(s2.status, 200, JSON.stringify(s2.json));
  const victim = s2.json.currentSubmissionId as string;
  const r1 = await student.req('POST', '/api/student/round1/autosave', { submissionId: victim, promptText: 'pwned', aiOutputText: '' });
  assert.equal(r1.status, 403);
  const r2 = await student.req('POST', '/api/student/round1/advance', { submissionId: victim, promptText: 'pwned', aiOutputText: '' });
  assert.equal(r2.status, 403);
  const mine = await student2.req('GET', '/api/student/round1/state');
  const sub = (mine.json.submissions as { id: string; prompt_text: string }[]).find((s) => s.id === victim);
  assert.notEqual(sub?.prompt_text, 'pwned');
});

test('cross-site requests are blocked even with a valid admin cookie (CSRF)', async () => {
  const r = await admin.req('POST', '/api/admin/round1/control', { action: 'pause' }, { Origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const r2 = await admin.req('POST', '/api/admin/round1/control', { action: 'pause' }, { 'Sec-Fetch-Site': 'cross-site' });
  assert.equal(r2.status, 403);
});

test('logout revokes the session server-side: a replayed cookie stops working', async () => {
  const a = new Actor('temp admin');
  await orgLogin(a, 'admin2@staging.local');
  const saved = a.cookie;
  assert.equal((await a.req('GET', '/api/admin/round1/status')).status, 200);
  assert.equal((await a.req('POST', '/api/auth/logout')).status, 200);
  const replay = new Actor('replay');
  replay.cookie = saved;
  assert.equal((await replay.req('GET', '/api/admin/round1/status')).status, 401);
});

test('login: rate limits, generic errors, no account enumeration by message, no open redirect', async () => {
  const bad1 = await anon.req('POST', '/api/organizer/login', { email: 'admin@staging.local', password: 'wrong' });
  const bad2 = await anon.req('POST', '/api/organizer/login', { email: 'nobody@staging.local', password: 'wrong' });
  assert.equal(bad1.status, 401);
  assert.equal(bad1.json.error, bad2.json.error);
  let limited = false;
  for (let i = 0; i < 8; i++) {
    const r = await anon.req('POST', '/api/organizer/login', { email: 'judge@staging.local', password: `nope${i}` });
    if (r.status === 429) { limited = true; break; }
  }
  assert.ok(limited, 'per-account lockout');

  const wrongCode = await anon.req('POST', '/api/student/login', { entryCode: '150', accessCode: '0000' === accessCode(env.EVENT_SECRET!) ? '1111' : '0000' });
  assert.equal(wrongCode.status, 401);
  const sqli = await anon.req('POST', '/api/student/login', { entryCode: "1' OR '1'='1", accessCode: '1234' });
  assert.equal(sqli.status, 400);

  for (const next of ['//evil.example', '/\\evil.example', 'https://evil.example', '/%5Cevil.example']) {
    const r = await admin.req('GET', `/organizer/login?next=${encodeURIComponent(next)}`);
    const loc = r.headers.get('location') ?? '';
    assert.ok(r.status >= 300 && r.status < 400, `redirect for ${next}`);
    assert.ok(!/^(https?:)?\/\/|^\/\\/.test(loc.replace(/^https?:\/\/127\.0\.0\.1:3100/, '')), `unsafe redirect ${loc} for ${next}`);
  }
});

test('pages: protected pages redirect, signed-in students skip the login page, students cannot open organizer pages', async () => {
  for (const path of ['/admin/dashboard', '/admin/attendance', '/admin/challenges', '/display', '/organizer/hub']) {
    const r = await anon.req('GET', path);
    assert.ok([307, 308].includes(r.status) && (r.headers.get('location') ?? '').includes('/organizer/login'), `${path} → ${r.status}`);
    const s = await student.req('GET', path);
    assert.ok([307, 308].includes(s.status), `student on ${path} → ${s.status}`);
  }
  const login = await student.req('GET', '/student/login');
  assert.ok([307, 308].includes(login.status) && (login.headers.get('location') ?? '').includes('/student/waiting'));
  const waiting = await anon.req('GET', '/student/waiting');
  assert.ok((waiting.headers.get('location') ?? '').includes('/student/login'));
  const vol = await volunteer.req('GET', '/admin/dashboard');
  assert.ok([307, 308].includes(vol.status), 'volunteer cannot open the admin dashboard');
});

test('security headers and no-store API responses', async () => {
  const page = await anon.req('GET', '/');
  for (const h of ['content-security-policy', 'x-frame-options', 'x-content-type-options', 'referrer-policy', 'strict-transport-security']) {
    assert.ok(page.headers.get(h), `missing ${h}`);
  }
  assert.equal(page.headers.get('x-powered-by'), null);
  const api = await admin.req('GET', '/api/admin/round1/status');
  assert.match(api.headers.get('cache-control') ?? '', /no-store/);
  const cookieFlags = await fetch('http://127.0.0.1:3100/api/organizer/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'desk@staging.local', password: PASSWORD }) });
  const set = cookieFlags.headers.getSetCookie().join(';');
  assert.match(set, /HttpOnly/i);
  assert.match(set, /Secure/i);
  assert.match(set, /SameSite=lax/i);
  assert.match(set, /__Host-/);
});

test('oversized and malformed bodies are rejected', async () => {
  const big = await student.req('POST', '/api/student/round1/autosave', { submissionId: NIL, promptText: 'x'.repeat(300_000), aiOutputText: '' });
  assert.equal(big.status, 413);
  const res = await fetch('http://127.0.0.1:3100/api/student/heartbeat', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: student.cookie! }, body: '{not json' });
  assert.equal(res.status, 400);
});

test('the cron route is closed without the bearer secret and errors do not leak internals', async () => {
  assert.equal((await anon.req('GET', '/api/cron/process-evaluations')).status, 401);
  assert.equal((await anon.req('GET', '/api/cron/process-evaluations', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  const r = await admin.req('GET', `/api/admin/entries/not-a-uuid/round1`);
  assert.equal(r.status, 404);
  assert.ok(!JSON.stringify(r.json).match(/postgres|PGRST|supabase|stack/i));
});
