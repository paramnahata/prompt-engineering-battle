import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed, setCommon, studentSession } from './helpers';

const DB = 'peb_test_round1';
let db: Pool;
let ids: Awaited<ReturnType<typeof seed>>;

before(async () => {
  resetDb(DB);
  db = pool(DB);
  ids = await seed(db, { entries: 5, present: 4, pool: 6 });
});
after(async () => { await db.end(); });

type R = { ok: boolean; status?: number; code?: string; [k: string]: unknown };
const control = (action: string, confirm: string | null = null) => rpc<R>(db, 'round1_control', [action, ids.adminId, confirm]);

test('start is refused until both common challenges are chosen', async () => {
  const r = await control('start');
  assert.equal(r.ok, false);
  assert.equal(r.code, 'preflight_failed');
  assert.match(String(r.message), /Common A is not chosen/);
  const round = await one<{ status: string }>(db, `select status from rounds where round_number = 1`);
  assert.equal(round.status, 'not_started');
});

test('start assigns 2 common + 2 distinct balanced random challenges to every present entry only', async () => {
  await setCommon(db, ids.challengeIds);
  const r = await control('start');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.assigned, 4);

  const rows = (await db.query(`select entry_id, position, challenge_id, is_common from challenge_assignments order by entry_id, position`)).rows;
  assert.equal(rows.length, 16);
  const byEntry = new Map<string, typeof rows>();
  for (const row of rows) byEntry.set(row.entry_id, [...(byEntry.get(row.entry_id) ?? []), row]);
  assert.ok(!byEntry.has(ids.entryIds[4]!), 'absent entry gets nothing');
  for (const [, list] of byEntry) {
    assert.deepEqual(list.map((x) => x.position), [1, 2, 3, 4]);
    assert.equal(list[0]!.challenge_id, ids.challengeIds[0]);
    assert.equal(list[1]!.challenge_id, ids.challengeIds[1]);
    assert.notEqual(list[2]!.challenge_id, list[3]!.challenge_id);
    assert.ok(!ids.challengeIds.slice(0, 2).includes(list[2]!.challenge_id));
  }
  const usage = (await db.query(`select challenge_id, count(*)::int n from challenge_assignments where position in (3,4) group by 1`)).rows;
  const counts = usage.map((u) => u.n);
  assert.ok(Math.max(...counts) - Math.min(...counts) <= 1, `balanced usage ${counts}`);
  const subs = await one<{ n: number }>(db, `select count(*)::int n from submissions`);
  assert.equal(subs.n, 16, 'one draft submission per assignment');
});

test('a second start (double click / second admin) is rejected and changes nothing', async () => {
  const before = await one<{ round_end_at: Date }>(db, `select round_end_at from rounds where round_number = 1`);
  const results = await Promise.all([control('start'), control('start'), control('start')]);
  assert.ok(results.every((r) => r.ok === false && r.code === 'bad_state'));
  const afterRow = await one<{ round_end_at: Date; n: number }>(db, `select round_end_at, (select count(*)::int from challenge_assignments) n from rounds where round_number = 1`);
  assert.equal(afterRow.round_end_at.getTime(), before.round_end_at.getTime());
  assert.equal(afterRow.n, 16);
});

test('state starts the current challenge timer once, server-side, capped by the round end', async () => {
  const entry = ids.entryIds[0]!;
  const sid = await studentSession(db, entry);
  const s1 = await rpc<R & { currentSubmissionId: string; submissions: { id: string; question_end_at: string }[] }>(db, 'student_round1_state', [sid, entry]);
  assert.equal(s1.ok, true);
  const cur = s1.submissions.find((s) => s.id === s1.currentSubmissionId)!;
  assert.ok(cur.question_end_at);
  const s2 = await rpc<typeof s1>(db, 'student_round1_state', [sid, entry]);
  const cur2 = s2.submissions.find((s) => s.id === s2.currentSubmissionId)!;
  assert.equal(cur2.question_end_at, cur.question_end_at, 'refresh/new tab does not reset the timer');
  const secs = (new Date(cur.question_end_at).getTime() - Date.now()) / 1000;
  assert.ok(secs > 440 && secs <= 451, `≈450s, got ${secs}`);
});

test('autosave enforces session, ownership, limits and deadline', async () => {
  const entry = ids.entryIds[0]!;
  const other = ids.entryIds[1]!;
  const sid = await studentSession(db, entry);
  const otherSid = await studentSession(db, other);
  const st = await rpc<R & { currentSubmissionId: string }>(db, 'student_round1_state', [sid, entry]);
  const subId = st.currentSubmissionId;

  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, subId, 'hello world', 'out'])).ok, true);
  const saved = await one<{ prompt_text: string }>(db, 'select prompt_text from submissions where id = $1', [subId]);
  assert.equal(saved.prompt_text, 'hello world');

  // IDOR: another entry's valid session cannot write this submission.
  const idor = await rpc<R>(db, 'student_autosave', [otherSid, other, subId, 'hijack', '']);
  assert.equal(idor.status, 403);
  // Session/entry mismatch (tampered cookie claiming another entry).
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, other, subId, 'x', ''])).status, 401);
  // Ended session.
  await db.query(`update auth_sessions set ended_at = now() where id = $1`, [otherSid]);
  assert.equal((await rpc<R>(db, 'student_autosave', [otherSid, other, subId, 'x', ''])).status, 401);

  const words = Array.from({ length: 21 }, (_, i) => `w${i}`).join(' ');
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, subId, words, ''])).code, 'word_limit');
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, subId, 'ok', 'x'.repeat(201)])).code, 'char_limit');
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, subId, "'); drop table entries; --", ''])).ok, true, 'SQL text is stored as data');
  assert.ok((await one<{ n: number }>(db, 'select count(*)::int n from entries')).n === 5);

  await db.query(`update submissions set question_end_at = now() - interval '10 seconds' where id = $1`, [subId]);
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, subId, 'late', ''])).code, 'expired');
  await db.query(`update submissions set question_end_at = now() + interval '400 seconds' where id = $1`, [subId]);
});

test('advance is refused before the timer ends, then locks; final text inside grace is kept', async () => {
  const entry = ids.entryIds[0]!;
  const sid = await studentSession(db, entry);
  const st = await rpc<R & { currentSubmissionId: string }>(db, 'student_round1_state', [sid, entry]);
  const subId = st.currentSubmissionId;
  const early = await rpc<R>(db, 'student_advance', [sid, entry, subId, 'final words', 'o']);
  assert.equal(early.code, 'timer_not_expired');

  await db.query(`update submissions set question_end_at = now() - interval '3 seconds' where id = $1`, [subId]);
  const ok = await rpc<R>(db, 'student_advance', [sid, entry, subId, 'final words', 'o']);
  assert.equal(ok.ok, true);
  assert.equal(ok.finalSubmit, false);
  const row = await one<{ status: string; prompt_text: string }>(db, 'select status, prompt_text from submissions where id = $1', [subId]);
  assert.deepEqual(row, { status: 'locked', prompt_text: 'final words' });
  const again = await rpc<R>(db, 'student_advance', [sid, entry, subId, 'changed', 'o']);
  assert.equal(again.alreadyDone, true, 'idempotent');
  assert.equal((await one<{ prompt_text: string }>(db, 'select prompt_text from submissions where id = $1', [subId])).prompt_text, 'final words');

  const next = await rpc<R & { currentSubmissionId: string }>(db, 'student_round1_state', [sid, entry]);
  assert.notEqual(next.currentSubmissionId, subId, 'next challenge becomes current with a fresh timer');
});

test('concurrent final submits produce exactly one reference and one job per answer', async () => {
  const entry = ids.entryIds[1]!;
  const sid = await studentSession(db, entry);
  await rpc(db, 'student_round1_state', [sid, entry]);
  // Fast-forward: lock 1-3, put 4 as current and expired.
  await db.query(`update submissions s set status = 'locked' from challenge_assignments a where a.id = s.assignment_id and s.entry_id = $1 and a.position < 4`, [entry]);
  const last = await one<{ id: string }>(db, `select s.id from submissions s join challenge_assignments a on a.id = s.assignment_id where s.entry_id = $1 and a.position = 4`, [entry]);
  await db.query(`update submissions set question_start_at = now() - interval '460 seconds', question_end_at = now() - interval '2 seconds' where id = $1`, [last.id]);

  const results = await Promise.all(Array.from({ length: 8 }, () => rpc<R>(db, 'student_advance', [sid, entry, last.id, 'p', 'o'])));
  assert.ok(results.every((r) => r.ok));
  const refs = new Set((await db.query(`select submission_ref from submissions where entry_id = $1`, [entry])).rows.map((r) => r.submission_ref));
  assert.equal(refs.size, 1);
  const jobs = await one<{ n: number }>(db, `select count(*)::int n from evaluation_jobs j join submissions s on s.id = j.submission_id where s.entry_id = $1`, [entry]);
  assert.equal(jobs.n, 4);
});

test('a student who was away has expired challenges closed out by the server', async () => {
  const entry = ids.entryIds[2]!;
  const sid = await studentSession(db, entry);
  const st = await rpc<R & { currentSubmissionId: string }>(db, 'student_round1_state', [sid, entry]);
  await db.query(`update submissions set question_end_at = now() - interval '5 minutes' where id = $1`, [st.currentSubmissionId]);
  const st2 = await rpc<R & { currentSubmissionId: string; submissions: { id: string; status: string; position: number }[] }>(db, 'student_round1_state', [sid, entry]);
  assert.notEqual(st2.currentSubmissionId, st.currentSubmissionId);
  assert.equal(st2.submissions.find((s) => s.id === st.currentSubmissionId)!.status, 'locked');
});

test('pause freezes work; resume gives back exactly the paused time to round and in-progress challenges', async () => {
  const entry = ids.entryIds[3]!;
  const sid = await studentSession(db, entry);
  const st = await rpc<R & { currentSubmissionId: string }>(db, 'student_round1_state', [sid, entry]);
  const before = await one<{ q: Date; r: Date }>(db, `select s.question_end_at q, r.round_end_at r from submissions s, rounds r where s.id = $1 and r.round_number = 1`, [st.currentSubmissionId]);

  assert.equal((await control('pause')).ok, true);
  assert.equal((await control('pause')).code, 'bad_state');
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, st.currentSubmissionId, 'during pause', ''])).code, 'round_paused');
  assert.equal((await rpc<R>(db, 'student_advance', [sid, entry, st.currentSubmissionId, 'x', ''])).code, 'round_paused');
  // Simulate a 90-second pause.
  await db.query(`update rounds set paused_at = paused_at - interval '90 seconds' where round_number = 1`);
  const res = await control('resume');
  assert.equal(res.ok, true);
  const afterRow = await one<{ q: Date; r: Date; p: number }>(db, `select s.question_end_at q, r.round_end_at r, r.total_paused_seconds p from submissions s, rounds r where s.id = $1 and r.round_number = 1`, [st.currentSubmissionId]);
  const dq = (afterRow.q.getTime() - before.q.getTime()) / 1000;
  const dr = (afterRow.r.getTime() - before.r.getTime()) / 1000;
  assert.ok(dq >= 90 && dq < 92, `question shifted by ${dq}`);
  assert.ok(dr >= 90 && dr < 92, `round shifted by ${dr}`);
  assert.ok(afterRow.p >= 90);
});

test('late arrivals can be assigned while running', async () => {
  await db.query(`update entries set present = true where id = $1`, [ids.entryIds[4]]);
  const r = await control('assign_missing');
  assert.equal(r.ok, true);
  assert.equal(r.assigned, 1);
  assert.equal((await control('assign_missing')).assigned, 0);
});

test('stop ends the round and submits + queues every outstanding answer', async () => {
  const r = await control('stop');
  assert.equal(r.ok, true);
  const open = await one<{ n: number }>(db, `select count(*)::int n from submissions where status <> 'submitted'`);
  assert.equal(open.n, 0);
  const jobs = await one<{ n: number }>(db, `select count(*)::int n from evaluation_jobs`);
  const subs = await one<{ n: number }>(db, `select count(*)::int n from submissions`);
  assert.equal(jobs.n, subs.n);
  const audit = await one<{ n: number }>(db, `select count(*)::int n from admin_actions where action = 'stop_round1'`);
  assert.equal(audit.n, 1);
  // After the end nothing can be written.
  const entry = ids.entryIds[3]!;
  const sid = await studentSession(db, entry);
  const any = await one<{ id: string }>(db, `select id from submissions where entry_id = $1 limit 1`, [entry]);
  assert.equal((await rpc<R>(db, 'student_autosave', [sid, entry, any.id, 'x', ''])).code, 'round_ended');
  assert.equal((await control('pause')).code, 'bad_state');
  assert.equal((await control('start')).code, 'bad_state');
});

test('results: AI scores summed, latest human override wins, ties at the cutoff all qualify', async () => {
  const subs = (await db.query(`select s.id, s.entry_id from submissions s`)).rows;
  for (const s of subs) {
    const idx = ids.entryIds.indexOf(s.entry_id);
    const total = [10, 10, 10, 5, 1][idx] ?? 0; // entries 0-2 tie at the top
    await db.query(`insert into ai_evaluations (submission_id, prompt_clarity, context, specificity, creativity, constraint_handling, total) values ($1, 0,0,0,0,0, $2)`, [s.id, total]);
  }
  await db.query(`update evaluation_jobs set status = 'completed'`);
  const one4 = subs.find((s) => s.entry_id === ids.entryIds[4])!;
  await db.query(`insert into human_reviews (submission_id, new_total, reason) values ($1, 2, 'first'), ($1, 50, 'second')`, [one4.id]);
  await db.query(`update human_reviews set created_at = now() - interval '1 minute' where reason = 'first'`);

  const r = await rpc<R>(db, 'compute_round1_results', [ids.adminId, 20, false]);
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = (await db.query(`select e.entry_number, rr.score::float score, rr.rank, rr.qualified from round_results rr join entries e on e.id = rr.entry_id order by rr.rank, e.entry_number`)).rows;
  const byNum = Object.fromEntries(rows.map((x) => [x.entry_number, x]));
  assert.equal(byNum[5].score, 53, 'override 50 + 3×1');
  assert.equal(byNum[5].rank, 1);
  assert.equal(byNum[1].rank, 2);
  assert.equal(byNum[2].rank, 2);
  assert.equal(byNum[3].rank, 2);
  // 20% of 5 = 1 qualifier.
  assert.deepEqual(rows.filter((x) => x.qualified).map((x) => x.entry_number), [5]);
  const r40 = await rpc<R>(db, 'compute_round1_results', [ids.adminId, 40, false]);
  assert.equal(r40.qualified, 4, 'cut at rank 2 → the three tied entries all qualify');
});

test('start over requires the typed confirmation, keeps registrations/attendance, erases round data', async () => {
  assert.equal((await control('reset')).code, 'confirmation_required');
  assert.equal((await control('reset', 'start over')).code, 'confirmation_required');
  const r = await control('reset', 'START OVER');
  assert.equal(r.ok, true);
  const c = await one<{ a: number; s: number; j: number; ae: number; hr: number; rr: number; e: number; p: number; m: number; status: string }>(db, `select
    (select count(*)::int from challenge_assignments) a, (select count(*)::int from submissions) s, (select count(*)::int from evaluation_jobs) j,
    (select count(*)::int from ai_evaluations) ae, (select count(*)::int from human_reviews) hr, (select count(*)::int from round_results) rr,
    (select count(*)::int from entries) e, (select count(*)::int from entries where present) p, (select count(*)::int from team_members) m,
    (select status from rounds where round_number = 1) status`);
  assert.deepEqual(c, { a: 0, s: 0, j: 0, ae: 0, hr: 0, rr: 0, e: 5, p: 5, m: 5, status: 'not_started' });
});

test('round auto-ends after its deadline and finalizes answers', async () => {
  assert.equal((await control('start')).ok, true);
  await db.query(`update rounds set round_end_at = now() - interval '30 seconds' where round_number = 1`);
  const status = await one<{ s: string }>(db, `select round1_tick() s`);
  assert.equal(status.s, 'ended');
  const open = await one<{ n: number }>(db, `select count(*)::int n from submissions where status <> 'submitted'`);
  assert.equal(open.n, 0);
});
