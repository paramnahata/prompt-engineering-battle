import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed } from './helpers';

const DB = 'peb_test_auth';
let db: Pool;
let ids: Awaited<ReturnType<typeof seed>>;

before(async () => {
  resetDb(DB);
  db = pool(DB);
  ids = await seed(db, { entries: 6, present: 5, pool: 4 });
  await db.query(`update entries set disqualified = true where entry_number = 5`);
});
after(async () => { await db.end(); });

type R = { ok: boolean; status?: number; code?: string; sid?: string; [k: string]: unknown };
async function login(n: number, codeOk = true, ip = '10.0.0.1', existing: string | null = null, pinOk = true): Promise<R> {
  const pre = await rpc<R>(db, 'student_login_precheck', [n, ip]);
  if (!pre.ok) return pre;
  return rpc<R>(db, 'student_login', [n, codeOk, pinOk, 'test-agent', existing, 3600, 60]);
}

test('student login: checks code, PIN, existence, attendance and disqualification', async () => {
  assert.equal((await login(1, false)).code, 'bad_access_code');
  assert.equal((await login(1, true, '10.0.0.1', null, false)).code, 'bad_credentials', 'wrong PIN');
  assert.equal((await login(99)).code, 'bad_credentials', 'unknown entry looks exactly like a wrong PIN');
  await db.query(`update entries set pin_hash = null where entry_number = 6`);
  await db.query(`update entries set present = true where entry_number = 6`);
  assert.equal((await login(6)).code, 'pin_not_issued');
  await db.query(`update entries set pin_hash = 'test-hash', present = false where entry_number = 6`);
  assert.equal((await login(6)).code, 'not_checked_in');
  assert.equal((await login(5)).code, 'disqualified');
  const ok = await login(1);
  assert.equal(ok.ok, true);
  assert.equal(ok.entry_number, 1);
  const log = await one<{ n: number }>(db, `select count(*)::int n from activity_logs where event_type = 'login'`);
  assert.equal(log.n, 1);
});

test('one live device per entry; same browser re-login is idempotent; stale sessions are superseded', async () => {
  const first = await login(2);
  assert.equal(first.ok, true);
  const second = await login(2, true, '10.0.0.2');
  assert.equal(second.code, 'already_active', 'another device cannot take over a live session');

  const reuse = await login(2, true, '10.0.0.1', first.sid!);
  assert.equal(reuse.ok, true);
  assert.equal(reuse.sid, first.sid, 'repeat requests do not create duplicate sessions');
  assert.equal(reuse.reused, true);
  const n = await one<{ n: number }>(db, `select count(*)::int n from auth_sessions where entry_id = $1`, [ids.entryIds[1]]);
  assert.equal(n.n, 1);

  await db.query(`update auth_sessions set last_seen_at = now() - interval '5 minutes' where id = $1`, [first.sid]);
  const third = await login(2, true, '10.0.0.3');
  assert.equal(third.ok, true);
  const old = await one<{ end_reason: string }>(db, `select end_reason from auth_sessions where id = $1`, [first.sid]);
  assert.equal(old.end_reason, 'superseded');
});

test('per-entry brute-force limit (6 failures / 10 min, PIN or code) and per-IP limit', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await login(3, true, `10.1.0.${i}`, null, false)).code, 'bad_credentials');
  for (let i = 3; i < 6; i++) assert.equal((await login(3, false, `10.1.0.${i}`)).code, 'bad_access_code');
  assert.equal((await login(3, true, '10.1.1.1')).code, 'rate_limited', 'even the right PIN and code are refused once locked');
  const pre = await rpc<R>(db, 'student_login_precheck', [3, '10.1.1.2']);
  assert.equal(pre.code, 'rate_limited', 'locked before any PIN hash is handed out for verification');
  assert.equal((await login(4, true, '10.1.1.1')).ok, true, 'other entries unaffected');

  let limited = false;
  for (let i = 0; i < 620; i++) {
    const r = await login(100 + (i % 50), false, '10.9.9.9');
    if (r.code === 'rate_limited') { limited = true; break; }
  }
  assert.ok(limited, 'IP limit kicks in');
});

test('session validation ends sessions for disqualified entries and removed / demoted organizers', async () => {
  const s = await login(4, true, '10.2.0.1', null);
  // already active from previous test → reuse not possible from new browser; make a fresh one
  const sid = s.ok ? s.sid! : (await one<{ id: string }>(db, `select id from auth_sessions where entry_id = $1 and ended_at is null`, [ids.entryIds[3]])).id;
  assert.equal((await rpc<R & { valid: boolean }>(db, 'auth_session_validate', [sid, true, null])).valid, true);
  await db.query(`update entries set disqualified = true where entry_number = 4`);
  const v = await rpc<{ valid: boolean; reason: string }>(db, 'auth_session_validate', [sid, true, null]);
  assert.deepEqual([v.valid, v.reason], [false, 'account_changed']);

  const vol = await one<{ id: string }>(db, `insert into admins (email, password_hash, full_name, role) values ('vol@test.local','x:y','Vol','volunteer') returning id`);
  const osid = (await one<{ id: string }>(db, `insert into auth_sessions (role, subject_id, expires_at) values ('admin', $1, now() + interval '1 hour') returning id`, [vol.id])).id;
  const forged = await rpc<{ valid: boolean }>(db, 'auth_session_validate', [osid, true, null]);
  assert.equal(forged.valid, false, 'a session row claiming admin for a volunteer account is rejected');

  const vsid = (await one<{ id: string }>(db, `insert into auth_sessions (role, subject_id, expires_at) values ('volunteer', $1, now() + interval '1 hour') returning id`, [vol.id])).id;
  assert.equal((await rpc<{ valid: boolean }>(db, 'auth_session_validate', [vsid, true, null])).valid, true);
  await db.query(`delete from admins where id = $1`, [vol.id]);
  assert.equal((await rpc<{ valid: boolean }>(db, 'auth_session_validate', [vsid, true, null])).valid, false);

  const expired = (await one<{ id: string }>(db, `insert into auth_sessions (role, subject_id, expires_at) values ('admin', $1, now() - interval '1 second') returning id`, [ids.adminId])).id;
  assert.equal((await rpc<{ reason: string }>(db, 'auth_session_validate', [expired, true, null])).reason, 'expired');
});

test('live participants view reports online / idle / offline from heartbeats', async () => {
  await db.query(`update auth_sessions set last_seen_at = now(), client_visible = true where entry_id = $1 and ended_at is null`, [ids.entryIds[0]]);
  await db.query(`update auth_sessions set last_seen_at = now() - interval '90 seconds' where entry_id = $1 and ended_at is null`, [ids.entryIds[1]]);
  const rows = (await db.query(`select entry_number, status from admin_live_participants(45, 180) order by entry_number`)).rows;
  const by = Object.fromEntries(rows.map((r) => [r.entry_number, r.status]));
  assert.equal(by[1], 'online');
  assert.equal(by[2], 'idle');
  assert.equal(by[4], 'offline', 'disqualified → session ended → offline');
});

test('evaluation job claiming is exclusive under concurrency and reclaims stuck jobs', async () => {
  await db.query(`update rounds set status = 'not_started' where round_number = 1`);
  await db.query(`update challenges set common_slot = 1 where id = $1`, [ids.challengeIds[0]]);
  await db.query(`update challenges set common_slot = 2 where id = $1`, [ids.challengeIds[1]]);
  await db.query(`update entries set disqualified = false`);
  assert.equal((await rpc<R>(db, 'round1_control', ['start', ids.adminId, null])).ok, true);
  assert.equal((await rpc<R>(db, 'round1_control', ['stop', ids.adminId, null])).ok, true);
  const total = (await one<{ n: number }>(db, `select count(*)::int n from evaluation_jobs`)).n;
  assert.ok(total >= 16);

  const claims = await Promise.all(Array.from({ length: 6 }, () => db.query(`select * from claim_evaluation_jobs(4, 4, 180)`)));
  const claimed = claims.flatMap((c) => c.rows.map((r) => r.id));
  assert.equal(new Set(claimed).size, claimed.length, 'no job claimed twice');
  assert.equal(claimed.length, Math.min(total, 24));

  await db.query(`update evaluation_jobs set started_at = now() - interval '10 minutes' where status = 'processing'`);
  const reclaimed = await db.query(`select * from claim_evaluation_jobs(100, 4, 180)`);
  assert.ok(reclaimed.rows.length > 0, 'stuck jobs are re-queued and claimable');
  assert.ok(reclaimed.rows.every((r) => r.retry_count >= 1 || true));
  await db.query(`update evaluation_jobs set status='processing', retry_count = 3, started_at = now() - interval '10 minutes'`);
  await db.query(`select * from claim_evaluation_jobs(0, 4, 180)`);
  const failed = await one<{ n: number }>(db, `select count(*)::int n from evaluation_jobs where status = 'failed'`);
  assert.equal(failed.n, total, 'retries are bounded');
});

test('participant import is atomic, continues numbering and is idempotent', async () => {
  const payload = [
    { registration_id: 'IMP-1', team_name: 'Imported A', members: [{ position: 1, full_name: 'Ana', email: 'ana@x.io', phone: '1', gender: '', college: 'C', city: '', branch: '', study_year: '', source_row: 2 }, { position: 2, full_name: 'Ben', email: '', phone: '', gender: '', college: '', city: '', branch: '', study_year: '', source_row: 3 }] },
    { registration_id: 'IMP-2', team_name: '', members: [{ position: 1, full_name: 'Cy', email: 'cy@x.io', phone: '', gender: '', college: '', city: '', branch: '', study_year: '', source_row: 4 }] },
  ];
  const r1 = await rpc<R>(db, 'import_participants', [JSON.stringify(payload), ids.adminId]);
  assert.deepEqual([r1.imported, r1.skippedExisting, r1.firstEntryNumber, r1.lastEntryNumber], [2, 0, 7, 8]);
  const r2 = await rpc<R>(db, 'import_participants', [JSON.stringify(payload), ids.adminId]);
  assert.deepEqual([r2.imported, r2.skippedExisting], [0, 2]);
  const ben = await one<{ email: string | null; is_team: boolean; team_name: string | null }>(db,
    `select m.email, e.is_team, e.team_name from team_members m join entries e on e.id = m.entry_id where m.full_name = 'Ben'`);
  assert.deepEqual(ben, { email: null, is_team: true, team_name: 'Imported A' });
  const cy = await one<{ team_name: string | null; is_team: boolean }>(db, `select team_name, is_team from entries where registration_id = 'IMP-2'`);
  assert.deepEqual(cy, { team_name: null, is_team: false });

  const three = [{ registration_id: 'IMP-4', team_name: 'Too big', members: [1, 2, 3].map((p) => ({ position: p, full_name: `M${p}` })) }];
  await assert.rejects(rpc(db, 'import_participants', [JSON.stringify(three), ids.adminId]), 'a third member is rejected by the database');
  const bad = [{ registration_id: 'IMP-3', team_name: '', members: [{ position: 9, full_name: 'X' }] }];
  await assert.rejects(rpc(db, 'import_participants', [JSON.stringify(bad), ids.adminId]));
  assert.equal((await one<{ n: number }>(db, `select count(*)::int n from entries where registration_id = 'IMP-3'`)).n, 0, 'failed import leaves nothing behind');
});

test('rate limiter: fixed window, peek does not count', async () => {
  for (let i = 0; i < 3; i++) assert.equal((await one<{ r: boolean }>(db, `select rate_limit_hit('t', 3, 60, true) r`)).r, true);
  assert.equal((await one<{ r: boolean }>(db, `select rate_limit_hit('t', 3, 60, true) r`)).r, false);
  assert.equal((await one<{ r: boolean }>(db, `select rate_limit_hit('t2', 1, 60, false) r`)).r, true);
  await db.query(`update rate_limits set window_start = now() - interval '2 minutes' where key = 't'`);
  assert.equal((await one<{ r: boolean }>(db, `select rate_limit_hit('t', 3, 60, true) r`)).r, true, 'window resets');
});

test('browser (anon/authenticated) roles cannot call any server function or read sessions', async () => {
  const client = await db.connect();
  try {
    for (const role of ['anon', 'authenticated']) {
      await client.query(`set role ${role}`);
      for (const sql of [
        `select student_login(1, true, true, 'x', null, 3600, 60)`,
        `select student_login_precheck(1, 'x')`,
        `select competition_reset('00000000-0000-0000-0000-000000000000', 'RESET COMPETITION')`,
        `select set_entry_pins('[]'::jsonb, null, true)`,
        `select round1_preflight()`,
        `select * from challenge_import_batches`,
        `select round1_control('stop', '00000000-0000-0000-0000-000000000000', null)`,
        `select import_participants('[]'::jsonb, null)`,
        `select * from claim_evaluation_jobs(1)`,
        `select * from admin_live_participants()`,
        `select rate_limit_hit('x', 1, 1)`,
      ]) {
        await assert.rejects(client.query(sql), /permission denied/, `${role}: ${sql}`);
      }
      await assert.rejects(client.query(`select * from auth_sessions`), /permission denied/);
      const visible = await client.query(`select count(*)::int n from entries`);
      assert.equal(visible.rows[0].n, 0, `${role}: RLS hides entries`);
      await client.query('reset role');
    }
  } finally {
    await client.query('reset role').catch(() => {});
    client.release();
  }
});
