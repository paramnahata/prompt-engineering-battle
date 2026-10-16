import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { one, pool, resetDb, rpc, seed } from './helpers';

/**
 * Production regressions found on Supabase (0008): API calls run with
 * pg-safeupdate (UPDATE/DELETE need a WHERE clause), and "Delete all
 * participants" must work even when the audit log mentions those entries.
 */
const DB = 'peb_test_safeupdate';
let db: Pool;
let ids: Awaited<ReturnType<typeof seed>>;
type R = { ok: boolean; code?: string; deleted?: number };

before(async () => {
  resetDb(DB);
  db = pool(DB);
  ids = await seed(db, { entries: 3, present: 3, pool: 2 });
});
after(async () => { await db.end(); });

test('the harness really enforces safeupdate inside rpc() calls', async () => {
  await db.query(`create or replace function _unsafe_delete() returns int language plpgsql as $$ begin delete from rate_limits; return 1; end $$`);
  await assert.rejects(rpc(db, '_unsafe_delete', []), /DELETE requires a WHERE clause/);
  await db.query(`drop function _unsafe_delete()`);
});

test('Delete all participants works when audit-log rows reference the entries (rows are kept, entry_id nulled)', async () => {
  for (const id of ids.entryIds) {
    await db.query(`insert into admin_actions (admin_id, entry_id, action) values ($1, $2, 'mark_present')`, [ids.adminId, id]);
  }
  const r = await rpc<R>(db, 'clear_participants', [ids.adminId, 'DELETE ALL PARTICIPANTS']);
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.deleted, 3);
  const left = await one<{ e: number; a: number; orphan: number }>(db,
    `select (select count(*)::int from entries) e, (select count(*)::int from admin_actions where action = 'mark_present') a,
            (select count(*)::int from admin_actions where action = 'mark_present' and entry_id is not null) orphan`);
  assert.deepEqual(left, { e: 0, a: 3, orphan: 0 });
});

test('Reset Competition Data, Round 2 start over, final results and publication run under safeupdate', async () => {
  assert.equal((await rpc<R>(db, 'competition_reset', [ids.adminId, 'RESET COMPETITION'])).ok, true);
  assert.equal((await rpc<R>(db, 'round2_set_qualifiers', [ids.adminId, 'clear', []])).ok, true);
  assert.equal((await rpc<R>(db, 'round2_control', ['reset', ids.adminId, 'START OVER'])).ok, true);
  assert.equal((await rpc<R>(db, 'round1_control', ['reset', ids.adminId, 'START OVER'])).ok, true);
});
