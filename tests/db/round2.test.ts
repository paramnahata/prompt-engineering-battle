import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed, studentSession } from './helpers';

/**
 * Round 2 (configured by organizers), jury, final results, results
 * publication, targeted announcements and the extended global reset.
 */
const DB = 'peb_test_round2';
let db: Pool;
let ids: Awaited<ReturnType<typeof seed>>;
let r1Id = '';
let problemA = '';
let problemB = '';
let twist = '';
let judgeA = '';
let judgeB = '';
type R = { ok: boolean; status?: number; code?: string; message?: string; [k: string]: unknown };

const control = (action: string, confirm: string | null = null) => rpc<R>(db, 'round2_control', [action, ids.adminId, confirm]);
const saveConfig = (cfg: Record<string, unknown>) => rpc<R>(db, 'round2_save_config', [ids.adminId, JSON.stringify(cfg)]);
const quals = (action: string, entries: string[] = []) => rpc<R>(db, 'round2_set_qualifiers', [ids.adminId, action, entries]);
const baseConfig = () => ({
  durationMinutes: 30, problemMode: 'common', commonProblemId: problemA,
  twist: { enabled: true, mode: 'common', commonTwistId: twist },
  jury: { enabled: true, criteria: [
    { key: 'understanding', label: 'Understanding', max: 10 }, { key: 'response_quality', label: 'Quality', max: 10 },
    { key: 'adaptability', label: 'Adaptability', max: 10 }, { key: 'interaction', label: 'Interaction', max: 10 }] },
  ai: { enabled: true, maxPoints: 60 },
  limits: { promptWords: 50, outputChars: 500, rationaleWords: 30 },
  final: { round1Weight: 1, round2Weight: 1 },
});

before(async () => {
  resetDb(DB);
  db = pool(DB);
  ids = await seed(db, { entries: 8, present: 8, pool: 4 });
  r1Id = (await one<{ id: string }>(db, `select id from rounds where round_number = 1`)).id;
  problemA = (await one<{ id: string }>(db, `insert into round2_problems (problem_code, title, problem_statement, instructions, expected_output, evaluation_criteria)
    values ('R2-A', 'Clinic triage', 'Design a triage assistant', 'Be careful', 'SECRET EXPECTED OUTPUT', 'SECRET CRITERIA') returning id`)).id;
  problemB = (await one<{ id: string }>(db, `insert into round2_problems (problem_code, title, problem_statement) values ('R2-B', 'Farm planner', 'Plan crops') returning id`)).id;
  twist = (await one<{ id: string }>(db, `insert into surprise_twists (title, description) values ('Budget cut', 'Half the budget') returning id`)).id;
  judgeA = (await one<{ id: string }>(db, `insert into judges (email, password_hash, full_name) values ('j1@test.local', 'x', 'Judge One') returning id`)).id;
  judgeB = (await one<{ id: string }>(db, `insert into judges (email, password_hash, full_name) values ('j2@test.local', 'x', 'Judge Two') returning id`)).id;
  // Round 1 results: entries 1-4 qualified (entry 3 and 4 tie), 5-8 not.
  const scores = [180, 170, 160, 160, 120, 110, 100, 90];
  for (let i = 0; i < 8; i++) {
    await db.query(`insert into round_results (entry_id, round_id, score, rank, qualified) values ($1, $2, $3, $4, $5)`,
      [ids.entryIds[i], r1Id, scores[i], i === 3 ? 3 : i + 1, i < 4]);
  }
  await db.query(`update rounds set status = 'ended' where round_number = 1`);
});
after(async () => { await db.end(); });

test('configuration must be reviewed and saved; invalid values are rejected', async () => {
  let p = await rpc<R & { errors: string[] }>(db, 'round2_preflight', []);
  assert.equal(p.ok, false);
  assert.ok(p.errors.some((e) => /not been reviewed/.test(e)));
  assert.equal((await control('start')).code, 'preflight_failed');
  assert.equal((await saveConfig({ ...baseConfig(), durationMinutes: 1 })).code, 'invalid');
  const badJury = baseConfig();
  badJury.jury.criteria[0]!.max = 500;
  assert.equal((await saveConfig(badJury)).code, 'invalid');
  assert.equal((await saveConfig({ ...baseConfig(), jury: { ...baseConfig().jury, enabled: false }, ai: { enabled: false, maxPoints: 0 } })).code, 'invalid',
    'some scoring must be enabled');
  const ok = await saveConfig(baseConfig());
  assert.equal(ok.ok, true, JSON.stringify(ok));
  p = await rpc(db, 'round2_preflight', []);
  assert.deepEqual(p.errors, ['No finalists selected (Round 2 → Finalists).']);
});

test('finalists come from Round 1 qualification (ties included) and can be edited before start', async () => {
  const r = await quals('from_round1');
  assert.equal(r.ok, true);
  assert.equal(r.total, 4);
  await quals('add', [ids.entryIds[5]!]);
  await quals('remove', [ids.entryIds[5]!]);
  const n = await one<{ n: number }>(db, `select count(*)::int n from round2_qualifiers`);
  assert.equal(n.n, 4);
  const p = await rpc<R>(db, 'round2_preflight', []);
  assert.equal(p.ok, true, JSON.stringify(p));
});

test('start assigns the configured problem with a snapshot; students never receive expected output or criteria', async () => {
  const r = await control('start');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.assigned, 4);
  assert.equal((await control('start')).code, 'bad_state', 'double start refused');
  const rows = await db.query(`select a.problem_id, a.problem_snapshot, s.state from round2_assignments a join round2_states s using (entry_id)`);
  assert.ok(rows.rows.every((x) => x.problem_id === problemA && x.state === 'INITIAL_PROMPT' && x.problem_snapshot.title === 'Clinic triage'));
  // Editing the problem later does not change what teams received.
  await db.query(`update round2_problems set title = 'Changed' where id = $1`, [problemA]);
  const sid = await studentSession(db, ids.entryIds[0]!);
  const st = await rpc<R & { problem: Record<string, string>; state: string }>(db, 'student_round2_state', [sid, ids.entryIds[0]]);
  assert.equal(st.eligible, true);
  assert.equal(st.problem.title, 'Clinic triage');
  assert.ok(!JSON.stringify(st).includes('SECRET'), 'expected output / criteria never reach the student');
  const outsider = await studentSession(db, ids.entryIds[6]!);
  const o = await rpc<R>(db, 'student_round2_state', [outsider, ids.entryIds[6]]);
  assert.equal(o.eligible, false);
  assert.equal((await rpc<R>(db, 'student_round2_save', [outsider, ids.entryIds[6], 'save', '{}'])).code, 'not_finalist');
  // A session for one entry cannot act for another.
  assert.equal((await rpc<R>(db, 'student_round2_state', [sid, ids.entryIds[1]])).code, 'session_invalid');
  // Config is locked while running.
  assert.equal((await saveConfig(baseConfig())).code, 'round_active');
  assert.equal((await quals('remove', [ids.entryIds[0]!])).code, 'round_started');
});

test('student stages: initial → locked → twist → refinement → final (limits, idempotent, concurrent)', async () => {
  const e = ids.entryIds[0]!;
  const sid = await studentSession(db, e);
  const save = (action: string, fields: Record<string, string>) => rpc<R>(db, 'student_round2_save', [sid, e, action, JSON.stringify(fields)]);
  assert.equal((await save('save', { initialPrompt: 'word '.repeat(60) })).code, 'too_long');
  assert.equal((await save('submit_final', {})).code, 'wrong_stage');
  assert.equal((await save('save', { initialPrompt: 'First prompt', initialOutput: 'first output' })).ok, true);
  assert.equal((await save('submit_initial', {})).state, 'OUTPUT');
  assert.equal((await save('save', { initialPrompt: 'edit after lock' })).code, 'waiting_for_twist');

  // Entry 2 has not submitted its first attempt when the twist is revealed: it is locked as-is.
  const e2 = ids.entryIds[1]!;
  const sid2 = await studentSession(db, e2);
  await rpc(db, 'student_round2_save', [sid2, e2, 'save', JSON.stringify({ initialPrompt: 'Team 2 draft' })]);
  const rv = await control('reveal_twist');
  assert.equal(rv.ok, true);
  assert.equal(rv.revealed, 4);
  const st = await rpc<R & { twist: { title: string }; finalPrompt: string; state: string }>(db, 'student_round2_state', [sid, e]);
  assert.equal(st.state, 'SURPRISE_REVEALED');
  assert.equal(st.twist.title, 'Budget cut');
  assert.equal(st.finalPrompt, 'First prompt', 'final draft starts from the first attempt');
  const st2 = await rpc<R & { initialPrompt: string; initialSubmittedAt: string }>(db, 'student_round2_state', [sid2, e2]);
  assert.equal(st2.initialPrompt, 'Team 2 draft');
  assert.ok(st2.initialSubmittedAt);

  assert.equal((await save('save', { finalPrompt: 'Final prompt', finalOutput: 'final out', rationale: 'r '.repeat(40) })).code, 'too_long');
  assert.equal((await save('save', { finalPrompt: 'Final prompt', finalOutput: 'final out', rationale: 'Because' })).state, 'REFINEMENT');
  const results = await Promise.all(Array.from({ length: 6 }, () => save('submit_final', {})));
  assert.ok(results.every((r) => r.ok));
  const refs = new Set(results.map((r) => r.submissionRef));
  assert.equal(refs.size, 1, 'concurrent submits produce one reference');
  assert.match([...refs][0] as string, /^R2-1-/);
  assert.equal((await save('save', { finalPrompt: 'late' })).code, 'already_submitted');
  const job = await one<{ n: number }>(db, `select count(*)::int n from round2_eval_jobs where entry_id = $1`, [e]);
  assert.equal(job.n, 1, 'AI evaluation queued exactly once');
});

test('pause freezes saves and resume extends the deadline by the paused time', async () => {
  const before = await one<{ end: Date }>(db, `select round_end_at as end from rounds where round_number = 2`);
  assert.equal((await control('pause')).ok, true);
  const e = ids.entryIds[2]!;
  const sid = await studentSession(db, e);
  assert.equal((await rpc<R>(db, 'student_round2_save', [sid, e, 'save', '{}'])).code, 'round_paused');
  await db.query(`update rounds set paused_at = paused_at - interval '30 seconds' where round_number = 2`);
  const r = await control('resume');
  assert.equal(r.ok, true);
  const after = await one<{ end: Date }>(db, `select round_end_at as end from rounds where round_number = 2`);
  const shift = (after.end.getTime() - before.end.getTime()) / 1000;
  assert.ok(shift >= 30 && shift < 33, `deadline shifted by ${shift}s`);
});

test('jury: questions and answers, score limits, locking and admin unlock', async () => {
  const e = ids.entryIds[0]!;
  const q = await rpc<R & { id: string }>(db, 'jury_ask_question', [judgeA, null, e, 'Why this structure?']);
  assert.equal(q.ok, true);
  const sid = await studentSession(db, e);
  assert.equal((await rpc<R>(db, 'student_round2_answer', [sid, e, q.id, 'Because it is clear'])).ok, true);
  const other = await studentSession(db, ids.entryIds[1]!);
  assert.equal((await rpc<R>(db, 'student_round2_answer', [other, ids.entryIds[1], q.id, 'hijack'])).code, 'not_found', 'cannot answer another team');
  const st = await rpc<R & { questions: { answer: string }[] }>(db, 'student_round2_state', [sid, e]);
  assert.equal(st.questions[0]!.answer, 'Because it is clear');

  const score = (judge: string, entry: string, s: Record<string, number>, lock = false) =>
    rpc<R>(db, 'jury_save_score', [judge, entry, JSON.stringify(s), 'notes', lock]);
  assert.equal((await score(judgeA, e, { understanding: 11 })).code, 'out_of_range');
  assert.equal((await score(judgeA, e, { understanding: 8, response_quality: 7, adaptability: 9, interaction: 6 })).total, 30);
  assert.equal((await score(judgeA, e, { understanding: 8, response_quality: 8, adaptability: 9, interaction: 6 }, true)).locked, true);
  assert.equal((await score(judgeA, e, { understanding: 1 })).code, 'locked');
  assert.equal((await rpc<R>(db, 'jury_unlock_score', [ids.adminId, e, judgeA])).ok, true);
  assert.equal((await score(judgeA, e, { understanding: 8, response_quality: 8, adaptability: 9, interaction: 6 }, true)).ok, true);
  assert.equal((await score(judgeB, e, { understanding: 10, response_quality: 10, adaptability: 10, interaction: 9 }, true)).total, 39);
});

test('stop finalizes every finalist; final results need complete scores unless forced; weights, overrides and ties', async () => {
  const r = await control('stop');
  assert.equal(r.ok, true);
  const rows = await db.query(`select entry_id, state, auto_submitted, final_prompt from round2_states order by entry_id`);
  assert.ok(rows.rows.every((x) => x.state === 'FINAL_SUBMISSION'));
  assert.equal(rows.rows.filter((x) => x.auto_submitted).length, 3);
  assert.equal((await one<{ n: number }>(db, `select count(*)::int n from round2_eval_jobs`)).n, 4);
  assert.equal((await rpc<R>(db, 'jury_ask_question', [judgeA, null, ids.entryIds[0], 'late?'])).code, 'round_closed');

  let c = await rpc<R>(db, 'compute_final_results', [ids.adminId, false]);
  assert.equal(c.code, 'incomplete');
  assert.equal(c.pendingAi, 4);
  // AI scores for two teams; entry 1 → 30/60 → 30 points; entry 2 → 60/60 → 60.
  for (const [i, sub] of [[0, 30], [1, 60]] as const) {
    await db.query(`insert into round2_ai_evaluations (entry_id, problem_understanding, prompt_structure, context_specificity, creativity, constraint_handling, output_quality, ai_subtotal)
      values ($1, 0, 0, 0, 0, 0, 0, $2)`, [ids.entryIds[i], sub]);
    await db.query(`update round2_eval_jobs set status = 'completed' where entry_id = $1`, [ids.entryIds[i]]);
  }
  c = await rpc<R>(db, 'compute_final_results', [ids.adminId, true]);
  assert.equal(c.ok, true);
  const fr = await db.query(`select e.entry_number n, f.round1_score r1, f.round2_jury j, f.round2_ai ai, f.round2_score r2, f.final_score fs, f.rank
                               from final_results f join entries e on e.id = f.entry_id order by e.entry_number`);
  const byN = Object.fromEntries(fr.rows.map((x) => [x.n, x]));
  assert.equal(Number(byN[1].j), 35, 'jury = average of judges (31 and 39)');
  assert.equal(Number(byN[1].ai), 30);
  assert.equal(Number(byN[1].fs), 180 + 35 + 30);
  assert.equal(Number(byN[2].fs), 170 + 0 + 60);
  // Entries 3 and 4: R1 160 each, no jury, no AI → tie → same rank.
  assert.equal(byN[3].rank, byN[4].rank);

  await db.query(`insert into round2_reviews (entry_id, reviewer_id, old_score, new_score, reason) values ($1, $2, 0, 90, 'jury sheet re-checked')`, [ids.entryIds[2], ids.adminId]);
  await rpc(db, 'compute_final_results', [ids.adminId, true]);
  const o = await one<{ r2: string; fs: string; rank: number }>(db, `select round2_score r2, final_score fs, rank from final_results where entry_id = $1`, [ids.entryIds[2]]);
  assert.equal(Number(o.r2), 90, 'latest admin override replaces the Round 2 score');
  assert.equal(Number(o.fs), 250);
  assert.equal(o.rank, 1);

  await db.query(`update rounds set config = config || '{"final": {"round1Weight": 0, "round2Weight": 1}}' where round_number = 2`);
  await rpc(db, 'compute_final_results', [ids.adminId, true]);
  const w = await one<{ fs: string }>(db, `select final_score fs from final_results where entry_id = $1`, [ids.entryIds[0]]);
  assert.equal(Number(w.fs), 65, 'weights are applied');
  await db.query(`update rounds set config = config || '{"final": {"round1Weight": 1, "round2Weight": 1}}' where round_number = 2`);
  await rpc(db, 'compute_final_results', [ids.adminId, true]);
});

test('results are invisible to students until published, then shown per the publication settings', async () => {
  const e = ids.entryIds[0]!;
  const sid = await studentSession(db, e);
  let r = await rpc<{ round1: Record<string, unknown>; final: Record<string, unknown> }>(db, 'student_results', [sid, e]);
  assert.equal(r.round1.published, false);
  assert.equal(r.final.published, false);
  assert.equal(Object.keys(r.round1).length, 1, 'nothing but the flag before publishing');

  const pub = (scope: string, s: Record<string, unknown>) => rpc<R>(db, 'set_results_publication', [ids.adminId, scope, JSON.stringify(s)]);
  assert.equal((await pub('round1', { published: true, showFeedback: false, showLeaderboard: true, leaderboardSize: 3 })).ok, true);
  r = await rpc(db, 'student_results', [sid, e]);
  assert.equal(r.round1.score, 180);
  assert.equal(r.round1.rank, 1);
  assert.equal(r.round1.qualified, true);
  assert.equal((r.round1.leaderboard as unknown[]).length, 3);
  await pub('round1', { showScore: false, showRank: false });
  r = await rpc(db, 'student_results', [sid, e]);
  assert.equal(r.round1.score, null);
  assert.equal(r.round1.rank, null);
  assert.ok((r.round1.leaderboard as { score: unknown }[]).every((x) => x.score === null), 'leaderboard hides scores too');

  assert.equal((await pub('final', { published: true, showLeaderboard: false })).ok, true);
  r = await rpc(db, 'student_results', [sid, e]);
  assert.equal(r.final.finalist, true);
  assert.equal(r.final.leaderboard, null);
  const released = await one<{ n: number }>(db, `select count(*)::int n from final_results where released`);
  assert.ok(released.n > 0);
  const audit = await one<{ n: number }>(db, `select count(*)::int n from admin_actions where action like 'results_publication_%' and admin_id = $1`, [ids.adminId]);
  assert.ok(audit.n >= 3, 'every publication change is audited with the admin');
});

test('announcements are delivered only to their audience', async () => {
  await db.query(`update entries set present = false where id = $1`, [ids.entryIds[7]]);
  await db.query(`insert into announcements (message, audience) values ('to all', 'all'), ('checked in only', 'checked_in'), ('finalists only', 'round2')`);
  await db.query(`insert into announcements (message, audience, entry_ids) values ('just team 8', 'entries', array[$1::uuid])`, [ids.entryIds[7]]);
  const msgs = async (i: number) => {
    const sid = await studentSession(db, ids.entryIds[i]!);
    const d = await rpc<{ announcements: { message: string }[] }>(db, 'student_dashboard', [sid, ids.entryIds[i]]);
    return d.announcements.map((a) => a.message);
  };
  const finalist = await msgs(0);
  assert.ok(finalist.includes('to all') && finalist.includes('checked in only') && finalist.includes('finalists only') && !finalist.includes('just team 8'));
  const team8 = await msgs(7);
  assert.ok(team8.includes('to all') && team8.includes('just team 8') && !team8.includes('checked in only') && !team8.includes('finalists only'));
  const d = await rpc<{ entry: { members: unknown[] }; round2: { finalist: boolean } }>(db, 'student_dashboard', [await studentSession(db, ids.entryIds[0]!), ids.entryIds[0]]);
  assert.equal(d.round2.finalist, true);
  assert.equal(d.entry.members.length, 1);
});

test('Round 1 start-over is refused once Round 2 has begun; Round 2 start-over keeps finalists', async () => {
  await db.query(`update rounds set status = 'ended' where round_number = 1`);
  assert.equal((await rpc<R>(db, 'round1_start_over', [ids.adminId, 'START OVER'])).code, 'round2_started');
  assert.equal((await control('reset', 'nope')).code, 'confirmation_required');
  const r = await control('reset', 'START OVER');
  assert.equal(r.ok, true);
  const counts = await one<Record<string, number>>(db, `select (select count(*)::int from round2_states) s, (select count(*)::int from judge_scores) j,
    (select count(*)::int from final_results) f, (select count(*)::int from round2_qualifiers) q, (select count(*)::int from round2_eval_jobs) jobs`);
  assert.deepEqual(counts, { s: 0, j: 0, f: 0, q: 4, jobs: 0 });
  const pubs = await one<{ v: { final: { published: boolean } } }>(db, `select value v from event_settings where key = 'results_publication'`);
  assert.equal(pubs.v.final.published, false);
});

test('random problem mode balances problems; twist disabled goes straight to the final stage', async () => {
  await saveConfig({ ...baseConfig(), problemMode: 'random', commonProblemId: null, twist: { enabled: false, mode: 'common', commonTwistId: null } });
  const r = await control('start');
  assert.equal(r.ok, true, JSON.stringify(r));
  const rows = await db.query(`select a.problem_id, s.state from round2_assignments a join round2_states s using (entry_id)`);
  const a = rows.rows.filter((x) => x.problem_id === problemA).length;
  const b = rows.rows.filter((x) => x.problem_id === problemB).length;
  assert.equal(a + b, 4);
  assert.ok(Math.abs(a - b) <= 1, `balanced: ${a}/${b}`);
  assert.ok(rows.rows.every((x) => x.state === 'REFINEMENT'));
  assert.equal((await control('reveal_twist')).code, 'twist_disabled');
  // Late finalist while running gets assigned immediately.
  const add = await quals('add', [ids.entryIds[4]!]);
  assert.equal(add.assigned, 1);
  await control('stop');
});

test('global reset clears both rounds, finalists and publication; keeps problems, twists and configuration', async () => {
  const preview = await rpc<{ clear: Record<string, number>; keep: Record<string, number>; blocked: boolean }>(db, 'competition_reset_preview', []);
  assert.equal(preview.blocked, false);
  assert.equal(preview.clear.round2Finalists, 5);
  assert.equal(preview.keep.round2Problems, 2);
  const r = await rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION']);
  assert.equal(r.ok, true);
  const counts = await one<Record<string, number>>(db, `select (select count(*)::int from round2_qualifiers) q, (select count(*)::int from round2_states) s,
    (select count(*)::int from round2_problems) p, (select count(*)::int from surprise_twists) t, (select count(*)::int from round_results) rr`);
  assert.deepEqual(counts, { q: 0, s: 0, p: 2, t: 1, rr: 0 });
  const cfg = await one<{ c: { confirmed: boolean; problemMode: string } }>(db, `select config c from rounds where round_number = 2`);
  assert.equal(cfg.c.confirmed, true);
  assert.equal(cfg.c.problemMode, 'random');
  const pubs = await one<{ v: { round1: { published: boolean } } }>(db, `select value v from event_settings where key = 'results_publication'`);
  assert.equal(pubs.v.round1.published, false);
});

test('auto-end after the deadline finalizes Round 2', async () => {
  await quals('from_round1').catch(() => null);
  await db.query(`insert into round_results (entry_id, round_id, score, rank, qualified) values ($1, $2, 100, 1, true)`, [ids.entryIds[0], r1Id]);
  await quals('from_round1');
  assert.equal((await control('start')).ok, true);
  await db.query(`update rounds set round_end_at = now() - interval '30 seconds' where round_number = 2`);
  const status = await one<{ s: string }>(db, `select round2_tick() s`);
  assert.equal(status.s, 'ended');
  const st = await one<{ state: string }>(db, `select state from round2_states limit 1`);
  assert.equal(st.state, 'FINAL_SUBMISSION');
});

test('browser roles cannot execute the new functions or read new tables', async () => {
  const fns = ['round2_control(text,uuid,text)', 'student_round2_state(uuid,uuid)', 'student_results(uuid,uuid)', 'compute_final_results(uuid,boolean)',
    'set_results_publication(uuid,text,jsonb)', 'competition_reset_preview()', 'jury_save_score(uuid,uuid,jsonb,text,boolean)', 'app_schema_status()'];
  for (const role of ['anon', 'authenticated']) {
    for (const f of fns) {
      const r = await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, f]);
      assert.equal(r.ok, false, `${role} must not execute ${f}`);
    }
    for (const t of ['round2_qualifiers', 'round2_eval_jobs', 'round2_reviews']) {
      const r = await one<{ ok: boolean }>(db, `select has_table_privilege($1, $2, 'select') ok`, [role, t]);
      assert.equal(r.ok, false, `${role} must not read ${t}`);
    }
  }
  const pol = await one<{ q: string }>(db, `select qual q from pg_policies where tablename = 'announcements'`);
  assert.match(pol.q, /audience = 'all'/);
});
