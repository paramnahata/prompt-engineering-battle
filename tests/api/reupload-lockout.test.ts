import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Actor, stagingPin } from './client';

/** Re-uploading the participant sheet fills in details; the desk "release" lifts a wrong-PIN lockout. Synthetic data only. */
const PASSWORD = 'Staging-Only-Password-1';
const db = new Pool({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: 'peb_stage' });
after(async () => { await db.end(); });

const HEADER = 'SR.NO,ID ,NAMES,Team Name,PHONE NO:  ,E-MAIL,GENDER,COLLEGE,CITY,BRANCH,YEAR,DATE/TIME\n';
const RID = `RU-${Date.now()}`;

test('re-upload: missing details and a missing member are filled in; entry number unchanged', async () => {
  const admin = new Actor('admin');
  assert.equal((await admin.req('POST', '/api/organizer/login', { email: 'admin@staging.local', password: PASSWORD })).status, 200);

  const first = HEADER + `1,${RID},Kiran Patil,,9000001111,,MALE,JNEC,CSN,CSE,,\n`;
  const a = await admin.req('POST', '/api/admin/participants/import', { csvText: first, mode: 'confirm' });
  assert.equal(a.status, 200, JSON.stringify(a.json));
  assert.equal(a.json.imported, 1);
  const before = (await db.query('select id, entry_number from entries where registration_id = $1', [RID])).rows[0];

  const filled = HEADER + `1,${RID},Kiran Patil,Team K,,kiran@example.com,MALE,JNEC,CSN,CSE,2-YEAR,\n,,Leela Patil,,9000002222,leela@example.com,FEMALE,JNEC,CSN,CSE,2-YEAR,\n`;
  const pv = await admin.req('POST', '/api/admin/participants/import', { csvText: filled, mode: 'preview' });
  assert.equal(pv.status, 200);
  assert.equal((pv.json.totals as Record<string, number>).toUpdate, 1);
  assert.equal((pv.json.totals as Record<string, number>).toImport, 0);

  const b = await admin.req('POST', '/api/admin/participants/import', { csvText: filled, mode: 'confirm' });
  assert.equal(b.status, 200, JSON.stringify(b.json));
  assert.equal(b.json.updated, 1);
  const row = (await db.query('select id, entry_number, team_name, is_team from entries where registration_id = $1', [RID])).rows[0];
  assert.equal(row.entry_number, before.entry_number);
  assert.equal(row.team_name, 'Team K');
  assert.equal(row.is_team, true);
  const members = (await db.query('select member_position, full_name, email, phone, study_year from team_members where entry_id = $1 order by member_position', [row.id])).rows;
  assert.deepEqual(members, [
    { member_position: 1, full_name: 'Kiran Patil', email: 'kiran@example.com', phone: '9000001111', study_year: '2-YEAR' },
    { member_position: 2, full_name: 'Leela Patil', email: 'leela@example.com', phone: '9000002222', study_year: '2-YEAR' },
  ]);

  const c = await admin.req('POST', '/api/admin/participants/import', { csvText: filled, mode: 'confirm' });
  assert.equal(c.json.updated, 0, 'same sheet again changes nothing');
  assert.equal(c.json.imported, 0);
});

test('someone typing wrong PINs locks an entry; the desk release unlocks it', async () => {
  const desk = new Actor('desk');
  assert.equal((await desk.req('POST', '/api/organizer/login', { email: 'desk@staging.local', password: PASSWORD })).status, 200);
  const { rows } = await db.query("select id, entry_number from entries where registration_id like 'STG-REG-%' and present order by entry_number desc limit 1");
  const target = rows[0] as { id: string; entry_number: number };
  await desk.req('POST', '/api/admin/sessions/release', { entryId: target.id });

  const attacker = new Actor('attacker');
  for (let i = 0; i < 7; i++) await attacker.req('POST', '/api/student/login', { entryCode: String(target.entry_number), pin: '000000' });
  const team = new Actor('real team');
  const locked = await team.req('POST', '/api/student/login', { entryCode: String(target.entry_number), pin: stagingPin(target.entry_number) });
  assert.equal(locked.status, 429, 'locked after repeated wrong PINs');

  const rel = await desk.req('POST', '/api/admin/sessions/release', { entryId: target.id });
  assert.equal(rel.status, 200);
  const ok = await team.req('POST', '/api/student/login', { entryCode: String(target.entry_number), pin: stagingPin(target.entry_number) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  await desk.req('POST', '/api/admin/sessions/release', { entryId: target.id });
});
