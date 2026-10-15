import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed, studentSession } from './helpers';

/**
 * 0007: problem-pack import, per-problem twists, question-based jury scoring,
 * event defaults and the tie-break used to declare winners.
 */
const DB = 'peb_test_round2_pack';
let db: Pool;
let ids: Awaited<ReturnType<typeof seed>>;
let judgeA = '';
let judgeB = '';
type R = { ok: boolean; status?: number; code?: string; message?: string; [k: string]: unknown };
interface Cfg {
  confirmed: boolean; durationMinutes: number; problemMode: string;
  twist: { enabled: boolean; mode: string; commonTwistId: string | null };
  jury: { enabled: boolean; mode: string; questionCount: number; questionMax: number; criteria: unknown[] };
  ai: { enabled: boolean; maxPoints: number }; final: { round1Weight: number; round2Weight: number };
}
type Pre = R & { config: Cfg; errors: string[]; juryMax: number };

const control = (action: string, confirm: string | null = null) => rpc<R>(db, 'round2_control', [action, ids.adminId, confirm]);
const saveConfig = (cfg: object) => rpc<R>(db, 'round2_save_config', [ids.adminId, JSON.stringify(cfg)]);
const importPack = (problems: unknown[], disableOthers = false) => rpc<R>(db, 'round2_import_problems', [ids.adminId, JSON.stringify(problems), disableOthers]);
const score = (judge: string, entry: string, questions: unknown, lock = false) =>
  rpc<R>(db, 'jury_save_score', [judge, entry, JSON.stringify({ questions }), null, lock]);

const pack = (n: number, withTwist = true) => Array.from({ length: n }, (_, i) => ({
  problem_code: `p${String(i + 1).padStart(2, '0')}`, title: `Problem ${i + 1}`, category: 'Business', difficulty: 'Hard',
  problem_statement: `Main statement ${i + 1}`, twist_description: withTwist ? `VARIANT-${i + 1}` : '',
  sample_prompt: `JURY-SAMPLE-${i + 1}`, expected_output: `JURY-SOLUTION-${i + 1}`, evaluation_criteria: 'Rubric',
}));

before(async () => {
  resetDb(DB);
  db = pool(DB);
  ids = await seed(db, { entries: 6, present: 6, pool: 4 });
  judgeA = (await one<{ id: string }>(db, `insert into judges (email, password_hash, full_name) values ('ja@test.local', 'x', 'Judge A') returning id`)).id;
  judgeB = (await one<{ id: string }>(db, `insert into judges (email, password_hash, full_name) values ('jb@test.local', 'x', 'Judge B') returning id`)).id;
  const r1 = (await one<{ id: string }>(db, `select id from rounds where round_number = 1`)).id;
  const scores = [150, 140, 130, 120, 110, 100];
  for (let i = 0; i < 6; i++) {
    await db.query(`insert into round_results (entry_id, round_id, score, rank, qualified) values ($1, $2, $3, $4, $5)`,
      [ids.entryIds[i], r1, scores[i], i + 1, i < 4]);
  }
  await db.query(`update rounds set status = 'ended' where round_number = 1`);
});
after(async () => { await db.end(); });

test('defaults match the event format but still need an admin to review and save them', async () => {
  const p = await rpc<Pre>(db, 'round2_preflight', []);
  assert.equal(p.config.confirmed, false);
  assert.equal(p.config.durationMinutes, 25);
  assert.equal(p.config.problemMode, 'random');
  assert.deepEqual(p.config.twist, { enabled: true, mode: 'problem', commonTwistId: null });
  assert.equal(p.config.jury.mode, 'questions');
  assert.equal(p.config.jury.questionCount, 5);
  assert.equal(p.config.jury.questionMax, 10);
  assert.equal(Number(p.juryMax), 50);
  assert.deepEqual(p.config.ai, { enabled: true, maxPoints: 50 });
  assert.deepEqual(p.config.final, { round1Weight: 0, round2Weight: 1 });
  assert.ok(p.errors.some((e) => /not been reviewed/.test(e)));
});

test('problem pack import inserts, updates by code (case-insensitive), rejects duplicates and can disable other problems', async () => {
  const legacy = (await one<{ id: string }>(db, `insert into round2_problems (problem_code, title, problem_statement) values ('OLD-1', 'Old', 'Old statement') returning id`)).id;
  let r = await importPack(pack(3));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual([r.created, r.updated, r.disabled], [3, 0, 0]);
  const p1 = await one<{ problem_code: string; twist_description: string; sample_prompt: string; category: string }>(db,
    `select problem_code, twist_description, sample_prompt, category from round2_problems where problem_code = 'P01'`);
  assert.deepEqual(p1, { problem_code: 'P01', twist_description: 'VARIANT-1', sample_prompt: 'JURY-SAMPLE-1', category: 'Business' });

  const changed = pack(4);
  changed[0]!.title = 'Renamed';
  r = await importPack(changed, true);
  assert.deepEqual([r.created, r.updated, r.disabled, r.active], [1, 3, 1, 4]);
  assert.equal((await one<{ title: string }>(db, `select title from round2_problems where problem_code = 'P01'`)).title, 'Renamed');
  assert.equal((await one<{ active: boolean }>(db, `select active from round2_problems where id = $1`, [legacy])).active, false, 'not deleted, only disabled');

  await assert.rejects(importPack([...pack(1), ...pack(1)]), /ROUND2_IMPORT_DUPLICATE/);
  await assert.rejects(importPack([{ problem_code: 'X1', title: '', problem_statement: 'x' }]), /ROUND2_IMPORT_INVALID/);
  assert.equal((await importPack([])).code, 'empty');
  assert.equal((await one<{ n: number }>(db, `select count(*)::int n from round2_problems`)).n, 5, 'failed imports change nothing');
  assert.ok((await one<{ n: number }>(db, `select count(*)::int n from admin_actions where action = 'round2_problem_import'`)).n >= 2);
});

test('config validation: question mode and per-problem twist mode; preflight requires a twist on every problem teams can get', async () => {
  const cfg = (await rpc<Pre>(db, 'round2_preflight', [])).config;
  assert.equal((await saveConfig({ ...cfg, jury: { ...cfg.jury, questionCount: 0 } })).code, 'invalid');
  assert.equal((await saveConfig({ ...cfg, jury: { ...cfg.jury, questionMax: 0 } })).code, 'invalid');
  assert.equal((await saveConfig({ ...cfg, jury: { ...cfg.jury, mode: 'stars' } })).code, 'invalid');
  assert.equal((await saveConfig({ ...cfg, twist: { ...cfg.twist, mode: 'nope' } })).code, 'invalid');
  assert.equal((await saveConfig({ ...cfg, final: { round1Weight: 0, round2Weight: 0 } })).code, 'invalid');
  const saved = await saveConfig(cfg);
  assert.equal(saved.ok, true, JSON.stringify(saved));
  await rpc(db, 'round2_set_qualifiers', [ids.adminId, 'from_round1', []]);

  await db.query(`update round2_problems set twist_description = null where problem_code = 'P04'`);
  let p = await rpc<Pre>(db, 'round2_preflight', []);
  assert.ok(p.errors.some((e) => /1 problem\(s\).*no twist/.test(e)), JSON.stringify(p.errors));
  await db.query(`update round2_problems set twist_description = 'VARIANT-4' where problem_code = 'P04'`);
  p = await rpc(db, 'round2_preflight', []);
  assert.equal(p.ok, true, JSON.stringify(p.errors));
});

test('random mode gives every finalist a different problem; the twist is each team\'s own variant; private fields never reach students', async () => {
  const r = await control('start');
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.assigned, 4);
  const asg = await db.query(`select entry_id, problem_snapshot from round2_assignments`);
  assert.equal(new Set(asg.rows.map((x) => x.problem_snapshot.problem_code)).size, 4, '4 finalists, 4 active problems → all different');
  assert.ok(asg.rows.every((x) => x.problem_snapshot.twist_description?.startsWith('VARIANT-')));

  const sid = await studentSession(db, ids.entryIds[0]!);
  let st = await rpc<R & { problem: Record<string, string>; twist: unknown }>(db, 'student_round2_state', [sid, ids.entryIds[0]]);
  assert.equal(st.twist, null);
  const leak = JSON.stringify(st);
  assert.ok(!/VARIANT-|JURY-SAMPLE|JURY-SOLUTION/.test(leak), 'twist, sample prompt and solution stay hidden before the reveal');

  // A team whose snapshot lost its twist blocks the reveal and nothing changes.
  const victim = asg.rows[1]!;
  await db.query(`update round2_assignments set problem_snapshot = problem_snapshot - 'twist_description' where entry_id = $1`, [victim.entry_id]);
  assert.equal((await control('reveal_twist')).code, 'no_twist');
  assert.equal((await one<{ n: number }>(db, `select count(*)::int n from round2_states where twist_revealed_at is not null`)).n, 0);
  await db.query(`update round2_assignments set problem_snapshot = $2 where entry_id = $1`, [victim.entry_id, victim.problem_snapshot]);

  const rv = await control('reveal_twist');
  assert.equal(rv.ok, true, JSON.stringify(rv));
  assert.equal(rv.revealed, 4);
  const states = await db.query(`select s.entry_id, s.twist_id, s.twist_snapshot, a.problem_snapshot from round2_states s join round2_assignments a using (entry_id)`);
  for (const s of states.rows) {
    assert.equal(s.twist_id, null);
    assert.equal(s.twist_snapshot.description, s.problem_snapshot.twist_description, 'each team gets the variant of its own problem');
    assert.equal(s.twist_snapshot.title, 'The scenario changes');
  }
  st = await rpc(db, 'student_round2_state', [sid, ids.entryIds[0]]);
  assert.match(JSON.stringify(st.twist), /VARIANT-/);
  assert.ok(!/JURY-SAMPLE|JURY-SOLUTION/.test(JSON.stringify(st)), 'sample prompt and solution are never sent to students');
});

test('jury question mode: marks per question with the question text; validation; lock needs every question', async () => {
  const e1 = ids.entryIds[0]!;
  const q = (n: number, mark: unknown = 8) => Array.from({ length: n }, (_, i) => ({ question: `Q${i + 1}?`, mark, source: i % 2 ? 'suggested' : 'own' }));
  assert.equal((await score(judgeA, e1, q(6))).code, 'invalid', 'more questions than configured');
  assert.equal((await score(judgeA, e1, [])).code, 'invalid');
  assert.equal((await score(judgeA, e1, [{ question: '  ', mark: 5 }])).code, 'invalid', 'question text required');
  assert.equal((await score(judgeA, e1, [{ question: 'Why?', mark: '5' }])).code, 'invalid', 'mark must be a number');
  assert.equal((await score(judgeA, e1, [{ question: 'Why?', mark: 11 }])).code, 'out_of_range');
  assert.equal((await score(judgeA, e1, [{ question: 'Why?', mark: -1 }])).code, 'out_of_range');

  const draft = await score(judgeA, e1, q(3, 7));
  assert.equal(draft.ok, true, JSON.stringify(draft));
  assert.equal(Number(draft.total), 21);
  assert.equal((await score(judgeA, e1, q(3, 7), true)).code, 'incomplete', 'locking needs all 5 questions marked');

  const locked = await score(judgeA, e1, [...q(4, 8), { question: 'What would you change after the twist?', mark: 9.25, source: 'suggested' }], true);
  assert.equal(locked.ok, true);
  assert.equal(Number(locked.total), 41.3);
  assert.equal(Number(locked.max), 50);
  const row = await one<{ total: string; max_total: string; question_scores: { question: string; mark: number; source: string }[]; understanding: string }>(db,
    `select total, max_total, question_scores, understanding from judge_scores where entry_id = $1 and judge_id = $2`, [e1, judgeA]);
  assert.equal(Number(row.max_total), 50);
  assert.equal(row.question_scores.length, 5);
  assert.deepEqual(row.question_scores[4], { question: 'What would you change after the twist?', mark: 9.3, source: 'suggested' });
  assert.equal(Number(row.understanding), 0);
  assert.equal((await score(judgeA, e1, q(5, 1))).code, 'locked');
});

test('final result = jury average + scaled AI score; Round 2 decides by default; ties broken by jury, then AI, then Round 1', async () => {
  const [e1, e2, e3, e4] = ids.entryIds as [string, string, string, string];
  const five = (mark: number) => Array.from({ length: 5 }, (_, i) => ({ question: `Q${i}`, mark }));
  await score(judgeB, e1, five(9), true);            // e1 jury avg: (41.3 + 45) / 2 = 43.15 → 43.2
  await score(judgeA, e2, five(8), true);            // e2 jury 40
  await score(judgeA, e3, five(6), true);            // e3 jury 30
  await score(judgeA, e4, five(6), true);            // e4 jury 30
  const ai = async (entry: string, subtotal: number) => {
    await db.query(`insert into round2_ai_evaluations (entry_id, problem_understanding, prompt_structure, context_specificity, creativity, constraint_handling, output_quality, ai_subtotal)
                    values ($1, 0, 0, 0, 0, 0, 0, $2)`, [entry, subtotal]);
  };
  await ai(e1, 48); // 48/60 × 50 = 40
  await ai(e2, 60); // 50 → e2 = 40 + 50 = 90 vs e1 = 43.2 + 40 = 83.2
  await ai(e3, 24); // 20 → 50
  await ai(e4, 24); // 20 → 50; e3 and e4 equal on final, jury and AI → Round 1 (130 vs 120) decides
  assert.equal((await control('stop')).ok, true);
  await db.query(`update round2_eval_jobs set status = 'completed'`);
  const c = await rpc<R>(db, 'compute_final_results', [ids.adminId, false]);
  assert.equal(c.ok, true, JSON.stringify(c));
  const fr = await db.query(`select e.entry_number n, f.round2_jury j, f.round2_ai ai, f.final_score fs, f.rank
                               from final_results f join entries e on e.id = f.entry_id order by f.rank, e.entry_number`);
  assert.deepEqual(fr.rows.map((x) => [x.n, Number(x.j), Number(x.ai), Number(x.fs), x.rank]), [
    [2, 40, 50, 90, 1],
    [1, 43.2, 40, 83.2, 2],
    [3, 30, 20, 50, 3],
    [4, 30, 20, 50, 4],
  ]);
});

test('a configuration saved before 0007 (no jury mode) keeps criteria scoring', async () => {
  await control('reset', 'START OVER');
  await db.query(`update rounds set config = config - 'confirmed' || jsonb_build_object('jury', jsonb_build_object('enabled', true, 'criteria', jsonb_build_array(
      jsonb_build_object('key', 'understanding', 'label', 'U', 'max', 10), jsonb_build_object('key', 'response_quality', 'label', 'Q', 'max', 10),
      jsonb_build_object('key', 'adaptability', 'label', 'A', 'max', 5), jsonb_build_object('key', 'interaction', 'label', 'I', 'max', 5)))) where round_number = 2`);
  const p = await rpc<Pre>(db, 'round2_preflight', []);
  assert.equal(Number(p.juryMax), 30);
  await db.query(`update rounds set config = config || '{"confirmed": true}' where round_number = 2`);
  assert.equal((await control('start')).ok, true);
  const s = await rpc<R>(db, 'jury_save_score', [judgeA, ids.entryIds[0], JSON.stringify({ understanding: 9, response_quality: 8, adaptability: 5, interaction: 4 }), null, false]);
  assert.equal(s.ok, true, JSON.stringify(s));
  assert.equal(Number(s.total), 26);
  assert.equal(Number(s.max), 30);
  await control('stop');
});

test('browser roles cannot execute the 0007 functions', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const f of ['round2_import_problems(uuid,jsonb,boolean)', '_round2_jury_mode(jsonb)', 'jury_save_score(uuid,uuid,jsonb,text,boolean)', 'round2_save_config(uuid,jsonb)']) {
      const r = await one<{ ok: boolean }>(db, `select has_function_privilege($1, $2, 'execute') ok`, [role, f]);
      assert.equal(r.ok, false, `${role} must not execute ${f}`);
    }
  }
  const s = await one<{ s: { version: number; missingFunctions: string[]; missingTables: string[] } }>(db, `select app_schema_status() s`);
  assert.deepEqual(s.s, { version: 8, missingFunctions: [], missingTables: [] });
});
