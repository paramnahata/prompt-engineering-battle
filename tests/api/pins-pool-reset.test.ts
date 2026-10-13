import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { hashPin } from '@/lib/auth/pin';
import { Actor, accessCode, loadStackEnv, stagingPin } from './client';

/**
 * PIN brute-force/revocation, challenge pool import → review → publish,
 * and the global reset, over HTTP against the local staging stack.
 */
const env = loadStackEnv();
const PASSWORD = 'Staging-Only-Password-1';
const admin = new Actor('admin');
const desk = new Actor('desk');
const code = () => accessCode(env.EVENT_SECRET!);
/** Unique challenge-code prefix per run so the suite can be re-run against the same staging DB. */
const P = `API${Date.now().toString(36).slice(-5).toUpperCase()}-`;

const db = new Pool({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: 'peb_stage' });

before(async () => {
  // Staging DB only: make the suite re-runnable (earlier runs lock entry 150 and re-issue 153's PIN).
  await db.query('delete from rate_limits');
  for (const n of [150, 151, 152, 153]) await db.query('update entries set pin_hash = $2 where entry_number = $1', [n, await hashPin(stagingPin(n))]);
  for (const [a, email] of [[admin, 'admin@staging.local'], [desk, 'desk@staging.local']] as const) {
    const r = await a.req('POST', '/api/organizer/login', { email, password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const st = await admin.req('GET', '/api/admin/round1/status');
  const status = (st.json.round as { status: string }).status;
  if (status === 'running' || status === 'paused') await admin.req('POST', '/api/admin/round1/control', { action: 'stop' });
  const reset = await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' });
  assert.equal(reset.status, 200, JSON.stringify(reset.json));
});
after(async () => { await db.end(); });

test('guessed PINs: wrong PIN = same answer as unknown entry; 6 failures lock the entry even for the right PIN', async () => {
  const guesser = new Actor('guesser');
  const unknown = await guesser.req('POST', '/api/student/login', { entryCode: '9999', pin: '123456', accessCode: code() });
  const wrong = await guesser.req('POST', '/api/student/login', { entryCode: '150', pin: stagingPin(150) === '111222' ? '111223' : '111222', accessCode: code() });
  assert.equal(unknown.status, 401);
  assert.equal(wrong.status, 401);
  assert.equal(unknown.json.error, wrong.json.error);
  for (let i = 0; i < 5; i++) await guesser.req('POST', '/api/student/login', { entryCode: '150', pin: String(200000 + i), accessCode: code() });
  const locked = await guesser.req('POST', '/api/student/login', { entryCode: '150', pin: stagingPin(150), accessCode: code() });
  assert.equal(locked.status, 429, 'correct PIN refused after 6 failures');
  const other = new Actor('other team');
  const ok = await other.req('POST', '/api/student/login', { entryCode: '151', pin: stagingPin(151), accessCode: code() });
  assert.equal(ok.status, 200, 'other entries unaffected');
  const wrongCode = await new Actor('x').req('POST', '/api/student/login', { entryCode: '152', pin: stagingPin(152), accessCode: code() === '0000' ? '0001' : '0000' });
  assert.equal(wrongCode.status, 401);
  assert.match(String(wrongCode.json.error), /access code/i);
});

test('re-issuing a PIN signs the team out everywhere and the old PIN stops working', async () => {
  const s = new Actor('team 153');
  assert.equal((await s.req('POST', '/api/student/login', { entryCode: '153', pin: stagingPin(153), accessCode: code() })).status, 200);
  assert.equal((await s.req('GET', '/api/student/waiting/state')).status, 200);
  const list = await desk.req('GET', '/api/admin/participants');
  const e153 = (list.json.entries as { id: string; entry_number: number }[]).find((e) => e.entry_number === 153)!;
  const r = await desk.req('POST', '/api/admin/pins', { action: 'reissue', entryId: e153.id });
  const newPin = (r.json.issued as { pin: string }[])[0]!.pin;
  assert.equal((await s.req('GET', '/api/student/waiting/state')).status, 401, 'old session revoked');
  const old = await new Actor('old').req('POST', '/api/student/login', { entryCode: '153', pin: stagingPin(153), accessCode: code() });
  assert.equal(old.status, 401);
  const fresh = await new Actor('new').req('POST', '/api/student/login', { entryCode: '153', pin: newPin, accessCode: code() });
  assert.equal(fresh.status, 200);
});

test('volunteers can re-issue one PIN but cannot bulk-generate, reset, edit entries or touch the pool', async () => {
  assert.equal((await desk.req('POST', '/api/admin/pins', { action: 'issue_missing' })).status, 403);
  assert.equal((await desk.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' })).status, 403);
  assert.equal((await desk.req('PATCH', '/api/admin/challenges', { action: 'set_common', slot: 1, id: null })).status, 403);
  assert.equal((await desk.req('POST', '/api/admin/participants', { members: [{ full_name: 'X' }] })).status, 403);
});

test('team size: 3 members rejected on manual add / edit, solo entries accepted', async () => {
  const three = await admin.req('POST', '/api/admin/participants', { members: [{ full_name: 'A' }, { full_name: 'B' }, { full_name: 'C' }] });
  assert.equal(three.status, 400);
  const solo = await admin.req('POST', '/api/admin/participants', { members: [{ full_name: 'Solo Person', email: 'solo@example.com', phone: '9000000099' }] });
  assert.equal(solo.status, 200, JSON.stringify(solo.json));
  const csv = 'ID,NAMES,Team Name,E-MAIL\n9001,A,Trio,a@x.io\n,B,,b@x.io\n,C,,c@x.io\n';
  const pv = await admin.req('POST', '/api/admin/participants/import', { csvText: csv, mode: 'preview' });
  assert.equal((pv.json.totals as Record<string, number>).invalid, 1);
  assert.match(JSON.stringify(pv.json.entries), /maximum team size is 2/);
});

test('challenge pool: upload → draft preview (nothing live) → publish → refined file updates; history recorded', async () => {
  const sheets = [
    { name: 'Task', rows: [['Member', 'Role'], ['Someone', 'Creator']] },
    { name: 'Author', rows: [
      ['PS ID:', 'Category:', 'Difficulty:', 'Challenge Prompt:', 'Expected Output:', 'Evaluation Criteria:'],
      [`${P}001`, 'Logic', 'Hard', `Prompt for ${P}001`, 'out', 'crit'],
      [`${P}002`, 'Logic', 'EASY', `Prompt for ${P}002`, 'out', 'crit'],
      [`${P}003`, 'Data', 'Mid', `Prompt for ${P}003`, 'out', 'crit'],
      [`${P}003`, 'Data', 'Hard', 'duplicate', 'out', 'crit'],
    ] },
  ];
  const pv = await admin.req('POST', '/api/admin/challenges/import', { fileName: 'ps-v1.xlsx', sheets });
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  const totals = pv.json.totals as Record<string, number>;
  assert.deepEqual([totals.parsed, totals.new, totals.errors], [3, 3, 1]);
  const before = await admin.req('GET', `/api/admin/challenges?q=${P}`);
  assert.equal(before.json.total, 0, 'a draft changes nothing in the live pool');

  const pub = await admin.req('POST', `/api/admin/challenges/import/${pv.json.batchId}`, { action: 'publish', mode: 'merge', poolStatus: 'approved', defaults: { prompt_word_limit: 150, output_char_limit: 2000 } });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  assert.equal(pub.json.inserted, 3);
  const again = await admin.req('POST', `/api/admin/challenges/import/${pv.json.batchId}`, { action: 'publish', mode: 'merge', poolStatus: 'approved', defaults: { prompt_word_limit: 150, output_char_limit: 2000 } });
  assert.equal(again.status, 409, 'a draft is published only once');

  const refined = JSON.parse(JSON.stringify(sheets));
  refined[1].rows[2][2] = 'Medium';
  refined[1].rows.pop();
  const pv2 = await admin.req('POST', '/api/admin/challenges/import', { fileName: 'ps-v2.xlsx', sheets: refined });
  assert.deepEqual([(pv2.json.totals as Record<string, number>).changed, (pv2.json.totals as Record<string, number>).unchanged], [1, 2]);
  const pub2 = await admin.req('POST', `/api/admin/challenges/import/${pv2.json.batchId}`, { action: 'publish', mode: 'merge', poolStatus: 'approved', defaults: { prompt_word_limit: 150, output_char_limit: 2000 } });
  assert.equal(pub2.json.updated, 1);

  const easy = await admin.req('GET', `/api/admin/challenges?q=${P}002`);
  assert.equal((easy.json.items as { difficulty: string }[])[0]!.difficulty, 'medium');
  const search = await admin.req('GET', `/api/admin/challenges?difficulty=hard&status=approved&q=${P.toLowerCase()}`);
  assert.deepEqual((search.json.items as { challenge_code: string }[]).map((i) => i.challenge_code), [`${P}001`]);
  const evil = await admin.req('GET', `/api/admin/challenges?q=${encodeURIComponent("x),id.not.is.null,(title.ilike.*")}`);
  assert.equal(evil.status, 200, 'filter metacharacters in search are neutralised');

  const hist = await admin.req('GET', '/api/admin/challenges/import');
  const files = (hist.json.batches as { file_name: string; status: string }[]).slice(0, 2).map((b) => `${b.file_name}:${b.status}`);
  assert.deepEqual(files, ['ps-v2.xlsx:published', 'ps-v1.xlsx:published']);
  assert.ok((hist.json.events as { action: string }[]).some((e) => e.action === 'challenge_pool_publish'));
});

test('common challenges must be approved; Easy is excluded by default and the readiness check reports it', async () => {
  const list = await admin.req('GET', `/api/admin/challenges?q=${P}`);
  const items = list.json.items as { id: string; challenge_code: string }[];
  const api1 = items.find((i) => i.challenge_code === `${P}001`)!;
  await admin.req('PATCH', '/api/admin/challenges', { action: 'bulk_update', ids: [api1.id], set: { pool_status: 'review' } });
  const bad = await admin.req('PATCH', '/api/admin/challenges', { action: 'set_common', slot: 1, id: api1.id });
  assert.equal(bad.status, 409);
  await admin.req('PATCH', '/api/admin/challenges', { action: 'bulk_update', ids: [api1.id], set: { pool_status: 'approved' } });

  const rules = await admin.req('GET', '/api/admin/challenges/rules');
  assert.deepEqual((rules.json.rules as { allowedDifficulties: string[] }).allowedDifficulties, ['medium', 'hard', 'expert']);
  const withEasy = await admin.req('PUT', '/api/admin/challenges/rules', { allowedDifficulties: ['easy', 'medium', 'hard', 'expert'], slot3Difficulties: [], slot4Difficulties: [], allowedCategories: [], distinctCategories: true });
  const restored = await admin.req('PUT', '/api/admin/challenges/rules', { allowedDifficulties: ['medium', 'hard', 'expert'], slot3Difficulties: [], slot4Difficulties: [], allowedCategories: [], distinctCategories: true });
  const n = (r: typeof withEasy) => (r.json.preflight as { slot3Eligible: number }).slot3Eligible;
  assert.ok(n(withEasy) > n(restored), 'excluding Easy shrinks the eligible pool');
});

test('global reset: refused while running, resets both rounds, keeps registrations/PINs/attendance/pool, works repeatedly', async () => {
  const before = await desk.req('GET', '/api/admin/participants');
  const poolBefore = (await admin.req('GET', '/api/admin/challenges?pageSize=10')).json.facets as { total: number };
  assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'start' })).status, 200);
  const blocked = await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' });
  assert.equal(blocked.status, 409);
  assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'stop' })).status, 200);
  assert.equal((await admin.req('POST', '/api/admin/competition/reset', { confirm: 'reset competition' })).status, 400);
  const ok = await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.ok(((ok.json.deleted as Record<string, number>).assignments ?? 0) > 0);

  const st = await admin.req('GET', '/api/admin/round1/status');
  assert.equal((st.json.round as { status: string }).status, 'not_started');
  assert.equal((st.json.counts as { submitted: number }).submitted, 0);
  const after = await desk.req('GET', '/api/admin/participants');
  const sig = (r: typeof before) => (r.json.entries as { id: string; present: boolean; pin_set_at: string | null; team_members: unknown[] }[])
    .map((e) => `${e.id}:${e.present}:${e.pin_set_at}:${e.team_members.length}`).join('|');
  assert.equal(sig(after), sig(before), 'registrations, attendance, PINs and members unchanged');
  assert.equal(((await admin.req('GET', '/api/admin/challenges?pageSize=10')).json.facets as { total: number }).total, poolBefore.total);
  const results = await admin.req('GET', '/api/admin/results');
  assert.equal((results.json.results as unknown[]).length, 0);
  assert.equal((await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' })).status, 200, 'repeatable');
  assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'start' })).status, 200, 'a fresh run starts after reset');
  await admin.req('POST', '/api/admin/round1/control', { action: 'stop' });
  await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' });
});
