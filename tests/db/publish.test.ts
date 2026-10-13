import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed } from './helpers';

const DB = 'peb_test_publish';
let db: Pool;
let adminId: string;
type R = { ok: boolean; code?: string; [k: string]: unknown };

const row = (code: string, over: Record<string, unknown> = {}) => ({
  challenge_code: code, title: `${code} title`, category: 'Logic', difficulty: 'medium', problem_statement: `Solve ${code}`,
  expected_output: 'out', evaluation_criteria: 'crit', source_ref: 'Sheet!A2', ...over,
});
async function batch(rows: unknown[]) {
  return (await one<{ id: string }>(db, `insert into challenge_import_batches (file_name, rows) values ('pool.xlsx', $1) returning id`, [JSON.stringify(rows)])).id;
}
const publish = (b: string, mode = 'merge', status = 'approved') => rpc<R>(db, 'publish_challenge_import', [b, adminId, mode, status, JSON.stringify({ prompt_word_limit: 180, output_char_limit: 2500 })]);

before(async () => {
  resetDb(DB);
  db = pool(DB);
  adminId = (await seed(db, { entries: 1, pool: 0 })).adminId;
  // Pre-existing rows like production: unreviewed, and a test question.
  await db.query(`update challenges set pool_status = 'review'`);
  await db.query(`insert into challenges (challenge_code, title, problem_statement, pool_status) values ('DEMO-1', 'demo', 'p', 'test')`);
});
after(async () => { await db.end(); });

test('merge publish inserts new codes, updates changed ones, counts unchanged, applies default limits', async () => {
  const r = await publish(await batch([row('LOG-001'), row('LOG-002', { difficulty: 'hard' }), row('T-001', { problem_statement: 'updated' })]));
  assert.deepEqual([r.inserted, r.updated, r.unchanged, r.archived], [2, 1, 0, 0]);
  const c = await one<{ prompt_word_limit: number; output_char_limit: number; pool_status: string }>(db, `select prompt_word_limit, output_char_limit, pool_status from challenges where challenge_code = 'LOG-001'`);
  assert.deepEqual(c, { prompt_word_limit: 180, output_char_limit: 2500, pool_status: 'approved' });
  const t = await one<{ problem_statement: string; pool_status: string }>(db, `select problem_statement, pool_status from challenges where challenge_code = 'T-001'`);
  assert.deepEqual(t, { problem_statement: 'updated', pool_status: 'approved' });
});

test('publishing the same draft twice is refused; re-uploading the same file changes nothing', async () => {
  const b = await batch([row('LOG-001'), row('LOG-002', { difficulty: 'hard' })]);
  const r1 = await publish(b);
  assert.deepEqual([r1.inserted, r1.updated, r1.unchanged], [0, 0, 2]);
  assert.equal((await publish(b)).code, 'already_published');
});

test('a refined file updates text/difficulty in place and keeps ids', async () => {
  const before = await one<{ id: string }>(db, `select id from challenges where challenge_code = 'LOG-002'`);
  const r = await publish(await batch([row('LOG-002', { difficulty: 'expert', problem_statement: 'refined' })]));
  assert.equal(r.updated, 1);
  const after = await one<{ id: string; difficulty: string; problem_statement: string }>(db, `select id, difficulty, problem_statement from challenges where challenge_code = 'LOG-002'`);
  assert.deepEqual(after, { id: before.id, difficulty: 'expert', problem_statement: 'refined' });
});

test('replace publish archives challenges missing from the file (not test ones) and clears their common slot', async () => {
  await db.query(`update challenges set common_slot = 1 where challenge_code = 'LOG-001'`);
  const r = await publish(await batch([row('LOG-002', { difficulty: 'expert', problem_statement: 'refined' }), row('NEW-1')]), 'replace');
  assert.equal(r.inserted, 1);
  const rows = Object.fromEntries((await db.query(`select challenge_code, pool_status, active, common_slot from challenges`)).rows.map((x) => [x.challenge_code, x]));
  assert.equal(rows['LOG-001'].pool_status, 'archived');
  assert.equal(rows['LOG-001'].active, false);
  assert.equal(rows['LOG-001'].common_slot, null);
  assert.equal(rows['DEMO-1'].pool_status, 'test', 'test questions untouched');
  assert.equal(rows['LOG-002'].pool_status, 'approved');
  const audit = await one<{ n: number }>(db, `select count(*)::int n from admin_actions where action = 'challenge_pool_publish'`);
  assert.equal(audit.n, 4);
});

test('publish as "review" keeps questions out of the event until approved', async () => {
  await publish(await batch([row('REV-1')]), 'merge', 'review');
  const p = await rpc<{ slot3Eligible: number }>(db, 'round1_preflight', []);
  const c = await one<{ pool_status: string }>(db, `select pool_status from challenges where challenge_code = 'REV-1'`);
  assert.equal(c.pool_status, 'review');
  const eligible = (await db.query(`select challenge_code from challenges c where _slot_eligible(c, _round1_rules(), 3)`)).rows.map((x) => x.challenge_code);
  assert.ok(!eligible.includes('REV-1'));
  assert.equal(p.slot3Eligible, eligible.length);
});
