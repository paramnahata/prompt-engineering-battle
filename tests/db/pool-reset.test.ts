import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed, setCommon, studentSession } from './helpers';

const DB = 'peb_test_pool';
let db: Pool;
let ids: Awaited<ReturnType<typeof seed>>;
type R = { ok: boolean; status?: number; code?: string; message?: string; [k: string]: unknown };

before(async () => {
  resetDb(DB);
  db = pool(DB);
  ids = await seed(db, { entries: 12, present: 12, pool: 0 });
  // A realistic mixed pool: 6 easy, 6 medium, 6 hard, 2 expert, 2 unrated, 2 test, across 3 categories.
  const levels = [...Array(6).fill('easy'), ...Array(6).fill('medium'), ...Array(6).fill('hard'), 'expert', 'expert', 'unrated', 'unrated'];
  for (let i = 0; i < levels.length; i++) {
    await db.query(`insert into challenges (challenge_code, title, problem_statement, difficulty, pool_status, category)
      values ($1, $1, 'p', $2, 'approved', $3)`, [`P-${String(i + 1).padStart(3, '0')}`, levels[i], ['Logic', 'Data', 'Creative'][i % 3]]);
  }
  await db.query(`insert into challenges (challenge_code, title, problem_statement, difficulty, pool_status) values ('DEMO-1','d','p','hard','test'), ('DEMO-2','d','p','hard','review')`);
});
after(async () => { await db.end(); });

const control = (action: string, confirm: string | null = null) => rpc<R>(db, 'round1_control', [action, ids.adminId, confirm]);
const rules = (r: Record<string, unknown>) => db.query(`update event_settings set value = $1 where key = 'round1_assignment_rules'`, [JSON.stringify(r)]);

test('preflight: commons must be approved; easy/unrated/test/review are excluded by default; counts are reported', async () => {
  let p = await rpc<R & { errors: string[]; slot3Eligible: number }>(db, 'round1_preflight', []);
  assert.equal(p.ok, false);
  assert.ok(p.errors.some((e) => /Common A is not chosen/.test(e)));
  await setCommon(db, ids.challengeIds);
  await db.query(`update challenges set pool_status = 'review' where id = $1`, [ids.challengeIds[0]]);
  p = await rpc(db, 'round1_preflight', []);
  assert.ok(p.errors.some((e) => /Common A .* must be active and approved/.test(e)));
  await db.query(`update challenges set pool_status = 'approved' where id = $1`, [ids.challengeIds[0]]);
  p = await rpc(db, 'round1_preflight', []);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
  // seed's two common challenges are medium; eligible random pool = 6 medium + 6 hard + 2 expert (non-common) = 14
  assert.equal(p.slot3Eligible, 14);
  await db.query(`update entries set pin_hash = null where entry_number = 1`);
  p = await rpc(db, 'round1_preflight', []);
  assert.ok((p.warnings as string[]).some((w) => /no PIN/.test(w)));
  await db.query(`update entries set pin_hash = 'h' where entry_number = 1`);
});

test('preflight blocks entries with no members (team size must be 1–2)', async () => {
  const e = await one<{ id: string }>(db, `insert into entries (entry_code, entry_number, registration_id, present, pin_hash) values ('ENTRY-099', 99, 'R99', true, 'h') returning id`);
  const p = await rpc<R & { errors: string[] }>(db, 'round1_preflight', []);
  assert.ok(p.errors.some((x) => /no members or more than 2/.test(x)));
  assert.equal((await control('start')).code, 'preflight_failed');
  await db.query(`delete from entries where id = $1`, [e.id]);
  await assert.rejects(db.query(`insert into team_members (entry_id, member_position, full_name) values ($1, 3, 'X')`, [ids.entryIds[0]]), 'no third member');
});

test('per-slot difficulty rules + distinct categories; every assignment snapshots the challenge', async () => {
  await rules({ allowedDifficulties: ['medium', 'hard', 'expert'], slot3Difficulties: ['medium'], slot4Difficulties: ['hard', 'expert'], allowedCategories: [], distinctCategories: true });
  const r = await control('start');
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = (await db.query(`select a.entry_id, a.position, c.difficulty, lower(c.category) cat, c.pool_status, a.challenge_snapshot
    from challenge_assignments a join challenges c on c.id = a.challenge_id order by a.entry_id, a.position`)).rows;
  assert.equal(rows.length, 12 * 4);
  for (const row of rows) {
    assert.equal(row.pool_status, 'approved');
    assert.ok(row.challenge_snapshot?.problem_statement, 'snapshot stored');
    if (row.position === 3) assert.equal(row.difficulty, 'medium');
    if (row.position === 4) assert.ok(['hard', 'expert'].includes(row.difficulty));
  }
  const byEntry = new Map<string, typeof rows>();
  for (const row of rows) byEntry.set(row.entry_id, [...(byEntry.get(row.entry_id) ?? []), row]);
  for (const list of byEntry.values()) assert.notEqual(list[2]!.cat, list[3]!.cat, 'slots 3 and 4 come from different categories');
  const usage = (await db.query(`select challenge_id, count(*)::int n from challenge_assignments where position = 3 group by 1`)).rows.map((x) => x.n);
  assert.ok(Math.max(...usage) - Math.min(...usage) <= 1, `balanced: ${usage}`);
});

test('editing or archiving a challenge later does not change what a team was given (history preserved)', async () => {
  const entry = ids.entryIds[0]!;
  const sid = await studentSession(db, entry);
  const before = await rpc<R & { assignments: { position: number; challenge: { problem_statement: string } }[] }>(db, 'student_round1_state', [sid, entry]);
  const a1 = await one<{ challenge_id: string }>(db, `select challenge_id from challenge_assignments where entry_id = $1 and position = 3`, [entry]);
  await db.query(`update challenges set problem_statement = 'CHANGED', active = false, pool_status = 'archived' where id = $1`, [a1.challenge_id]);
  const afterState = await rpc<typeof before>(db, 'student_round1_state', [sid, entry]);
  assert.equal(afterState.assignments.find((x) => x.position === 3)!.challenge.problem_statement, before.assignments.find((x) => x.position === 3)!.challenge.problem_statement);
  await assert.rejects(db.query(`delete from challenges where id = $1`, [a1.challenge_id]), 'referenced challenges cannot be hard-deleted');
});

test('pool publish is blocked while a round is active', async () => {
  const b = await one<{ id: string }>(db, `insert into challenge_import_batches (file_name, rows) values ('x.xlsx', '[]') returning id`);
  const r = await rpc<R>(db, 'publish_challenge_import', [b.id, ids.adminId, 'merge', 'approved', '{}']);
  assert.equal(r.code, 'round_active');
});

test('reset is refused while running, requires the phrase, and is serialized with start', async () => {
  assert.equal((await rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION'])).code, 'round_active');
  assert.equal((await control('stop')).ok, true);
  assert.equal((await rpc<R>(db, 'competition_reset', [ids.adminId, 'reset'])).code, 'confirmation_required');

  // Seed Round 2 records too, plus evaluations and results.
  await db.query(`insert into round2_problems (title, problem_statement) values ('R2', 'p')`);
  await db.query(`insert into round2_states (entry_id) values ($1)`, [ids.entryIds[0]]);
  await db.query(`insert into round2_assignments (entry_id, problem_id) select $1, id from round2_problems limit 1`, [ids.entryIds[0]]);
  await db.query(`insert into judges (email, password_hash, full_name) values ('j@t.local', 'x', 'J')`);
  await db.query(`insert into judge_scores (entry_id, judge_id) select $1, id from judges limit 1`, [ids.entryIds[0]]);
  await db.query(`insert into final_results (entry_id, round1_score, round2_score, final_score) values ($1, 1, 1, 2)`, [ids.entryIds[0]]);
  await db.query(`update rounds set status = 'ended' where round_number = 2`);
  await db.query(`insert into ai_evaluations (submission_id, prompt_clarity, context, specificity, creativity, constraint_handling, total) select id, 1,1,1,1,1,5 from submissions limit 3`);
  assert.equal((await rpc<R>(db, 'compute_round1_results', [ids.adminId, 50, true])).ok, true);

  const keep = async () => one(db, `select (select count(*)::int from entries) e, (select count(*)::int from team_members) m,
    (select count(*)::int from entries where pin_hash is not null) pins, (select count(*)::int from entries where present) present,
    (select count(*)::int from attendance) attendance, (select count(*)::int from challenges) challenges,
    (select count(*)::int from challenges where common_slot is not null) commons, (select count(*)::int from admins) admins,
    (select count(*)::int from event_settings) settings, (select count(*)::int from activity_logs where event_type in ('login', 'attendance')) keptlogs`);
  const before = await keep();

  // Concurrent: reset and a start racing each other must leave a consistent state.
  const [reset] = await Promise.all([rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION']), control('start')]);
  assert.equal(reset.ok, true, JSON.stringify(reset));
  const round = await one<{ status: string; n: number }>(db, `select status, (select count(*)::int from challenge_assignments) n from rounds where round_number = 1`);
  assert.ok((round.status === 'not_started' && round.n === 0) || (round.status === 'running' && round.n === 48), JSON.stringify(round));
  if (round.status === 'running') {
    await control('stop');
    assert.equal((await rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION'])).ok, true);
  }

  const cleared = await one(db, `select
    (select count(*)::int from challenge_assignments) a, (select count(*)::int from submissions) s, (select count(*)::int from submission_versions) v,
    (select count(*)::int from evaluation_jobs) j, (select count(*)::int from ai_evaluations) ai, (select count(*)::int from human_reviews) hr,
    (select count(*)::int from round_results) rr, (select count(*)::int from final_results) fr, (select count(*)::int from judge_scores) js,
    (select count(*)::int from round2_states) r2s, (select count(*)::int from round2_assignments) r2a, (select count(*)::int from announcements) ann,
    (select count(*)::int from rounds where status <> 'not_started' or round_start_at is not null or round_end_at is not null) rounds_dirty`);
  assert.deepEqual(cleared, { a: 0, s: 0, v: 0, j: 0, ai: 0, hr: 0, rr: 0, fr: 0, js: 0, r2s: 0, r2a: 0, ann: 0, rounds_dirty: 0 });
  assert.deepEqual(await keep(), before, 'registrations, members, PINs, attendance, pool, commons, accounts, settings, login/attendance logs preserved');
  const audit = await one<{ n: number }>(db, `select count(*)::int n from admin_actions where action = 'reset_competition'`);
  assert.ok(audit.n >= 1);

  // Repeatable: a full new run works after reset, and a second reset works.
  assert.equal((await control('start')).ok, true);
  assert.equal((await control('stop')).ok, true);
  assert.equal((await rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION'])).ok, true);
  assert.equal((await rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION'])).ok, true, 'idempotent');
});

test('participant wipe cannot race a round start (review finding P1)', async () => {
  const results = await Promise.all([control('start'), rpc<R>(db, 'clear_participants', [ids.adminId, 'DELETE ALL PARTICIPANTS'])]);
  const state = await one<{ status: string; a: number; e: number }>(db, `select status, (select count(*)::int from challenge_assignments) a, (select count(*)::int from entries) e from rounds where round_number = 1`);
  assert.ok(!(state.status === 'running' && state.a === 0), `inconsistent: ${JSON.stringify(state)} ${JSON.stringify(results)}`);
  if (state.status === 'running') {
    assert.equal(results[1].code, 'competition_data');
    await control('stop');
    await rpc(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION']);
  }
});

test('two admins deleting each other concurrently leaves one admin (review finding P1)', async () => {
  const a2 = await one<{ id: string }>(db, `insert into admins (email, password_hash, full_name, role) values ('a2@t.local','x','A2','admin') returning id`);
  const a3 = await one<{ id: string }>(db, `insert into admins (email, password_hash, full_name, role) values ('a3@t.local','x','A3','admin') returning id`);
  await db.query(`delete from admins where id = $1`, [ids.adminId]).catch(() => {}); // may be referenced by audit rows
  const admins = (await db.query(`select id from admins where role = 'admin'`)).rows.map((r) => r.id);
  if (admins.length === 3) {
    // ids.adminId is referenced by audit records; use the two fresh admins against each other and leave the referenced one aside.
    await db.query(`update admins set role = 'volunteer' where id = $1`, [ids.adminId]);
  }
  const res = await Promise.all([
    rpc<R>(db, 'delete_organizer_account', [a2.id, 'admin', a3.id]),
    rpc<R>(db, 'delete_organizer_account', [a3.id, 'admin', a2.id]),
  ]);
  const left = await one<{ n: number }>(db, `select count(*)::int n from admins where role = 'admin'`);
  assert.equal(left.n, 1, JSON.stringify(res));
  assert.ok(res.some((r) => r.code === 'last_admin'));
  assert.equal((await rpc<R>(db, 'delete_organizer_account', [a2.id, 'admin', a2.id])).code, 'self');
});

test('PIN issuance: only-missing does not overwrite; re-issue ends the entry\'s sessions', async () => {
  await db.query(`update entries set pin_hash = null where entry_number in (2, 3)`);
  const r = await rpc<R>(db, 'set_entry_pins', [JSON.stringify(ids.entryIds.slice(0, 4).map((id) => ({ entry_id: id, pin_hash: 'new' }))), null, true]);
  assert.equal(r.updated, 2);
  const hashes = (await db.query(`select entry_number, pin_hash from entries where entry_number <= 4 order by 1`)).rows.map((x) => x.pin_hash);
  assert.deepEqual(hashes, ['h', 'new', 'new', 'test-hash']);
  const sid = await studentSession(db, ids.entryIds[3]!);
  await rpc(db, 'set_entry_pins', [JSON.stringify([{ entry_id: ids.entryIds[3], pin_hash: 'again' }]), null, false]);
  const s = await one<{ end_reason: string }>(db, `select end_reason from auth_sessions where id = $1`, [sid]);
  assert.equal(s.end_reason, 'pin_reissued');
});

test('entry editing enforces 1–2 members and replaces contacts without copying', async () => {
  const id = ids.entryIds[5]!;
  assert.equal((await rpc<R>(db, 'update_entry', [id, null, JSON.stringify({ team_name: 'X', members: [] })])).code, 'team_size');
  assert.equal((await rpc<R>(db, 'update_entry', [id, null, JSON.stringify({ team_name: 'X', members: [{ full_name: 'a' }, { full_name: 'b' }, { full_name: 'c' }] })])).code, 'team_size');
  const ok = await rpc<R>(db, 'update_entry', [id, null, JSON.stringify({ team_name: ' Duo ', members: [{ full_name: 'Ana', email: 'ANA@X.IO', phone: '1' }, { full_name: 'Ben' }] })]);
  assert.equal(ok.ok, true);
  const m = (await db.query(`select member_position, full_name, email, phone from team_members where entry_id = $1 order by 1`, [id])).rows;
  assert.deepEqual(m, [{ member_position: 1, full_name: 'Ana', email: 'ana@x.io', phone: '1' }, { member_position: 2, full_name: 'Ben', email: null, phone: null }]);
  const e = await one<{ team_name: string; is_team: boolean }>(db, `select team_name, is_team from entries where id = $1`, [id]);
  assert.deepEqual(e, { team_name: 'Duo', is_team: true });
});
