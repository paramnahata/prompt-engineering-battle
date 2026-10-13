import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { PGHOST, PGPORT, pool } from './helpers';

const DB = 'peb_test_upgrade';
const MIG = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const psql = (args: string[], input?: string) =>
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-U', 'postgres', ...args], { env: { ...process.env, PGHOST, PGPORT: String(PGPORT) }, input, stdio: ['pipe', 'pipe', 'pipe'] });

test('0004 upgrades a production-shaped database with existing ENTRY-### rows', async () => {
  psql(['-d', 'postgres', '-c', `drop database if exists ${DB} with (force)`, '-c', `create database ${DB}`]);
  psql(['-d', DB, '-f', path.join(__dirname, 'supabase-roles.sql')]);
  for (const f of ['0001_init_schema.sql', '0002_rls.sql', '0003_reconcile_production_schema.sql']) psql(['-d', DB, '-f', path.join(MIG, f)]);
  psql(['-d', DB], `
    insert into entries (entry_code, registration_id, present) values
      ('ENTRY-001', 'R1', true), ('ENTRY-010', 'R10', false), ('ENTRY-002', 'R2', true), ('WEIRD', 'RX', false);
    insert into team_members (entry_id, member_position, full_name) select id, 1, 'M' from entries;
    insert into rounds (round_number, status) values (1, 'not_started');
  `);
  psql(['-d', DB, '-f', path.join(MIG, '0004_event_readiness.sql')]);

  const db = pool(DB);
  try {
    const rows = (await db.query(`select entry_code, entry_number from entries order by entry_number`)).rows;
    assert.deepEqual(rows.map((r) => [r.entry_code, r.entry_number]), [['ENTRY-001', 1], ['ENTRY-002', 2], ['ENTRY-010', 10], ['WEIRD', 11]]);
    const attendance = (await db.query(`select count(*)::int n from attendance`)).rows[0].n;
    assert.equal(attendance, 2, 'attendance trigger from 0003 logged the present rows');
    await assert.rejects(db.query(`insert into team_members (entry_id, member_position, full_name) select id, 5, 'X' from entries limit 1`));
  } finally {
    await db.end();
  }
  assert.ok(fs.existsSync(path.join(MIG, '0004_event_readiness.sql')));
});
