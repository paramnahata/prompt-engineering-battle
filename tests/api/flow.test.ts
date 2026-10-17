import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Pool } from 'pg';
import { Actor, loadStackEnv, stagingPin } from './client';

/**
 * End-to-end event flow over HTTP against the local staging stack:
 * import → check-in → login → start → autosave → advance ×4 → pause/resume
 * → stop → AI evaluation (mock Gemini) → results → logout.
 * The DB connection is used only to fast-forward timers.
 */
const env = loadStackEnv();
const PASSWORD = 'Staging-Only-Password-1';
const db = new Pool({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: 'peb_stage' });
const admin = new Actor('admin');
const desk = new Actor('desk');
const student = new Actor('student');
const otherDevice = new Actor('student other device');
let entryNumber = 0;
let entryId = '';
let pin = '';

before(async () => {
  for (const [a, email] of [[admin, 'admin@staging.local'], [desk, 'desk@staging.local']] as const) {
    const r = await a.req('POST', '/api/organizer/login', { email, password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  const st = await admin.req('GET', '/api/admin/round1/status');
  const status = (st.json.round as { status: string }).status;
  if (status === 'running' || status === 'paused') await admin.req('POST', '/api/admin/round1/control', { action: 'stop' });
  if (status !== 'not_started') {
    const r = await admin.req('POST', '/api/admin/round1/control', { action: 'reset', confirm: 'START OVER' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
});
after(async () => { await db.end(); });

test('CSV import: preview groups teams, confirm assigns next entry numbers, re-import is a no-op', async () => {
  const csvText = fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'participants-merged.csv'), 'utf8');
  const pv = await admin.req('POST', '/api/admin/participants/import', { csvText, mode: 'preview' });
  assert.equal(pv.status, 200, JSON.stringify(pv.json));
  const totals = pv.json.totals as Record<string, number>;
  assert.equal(totals.entries, 4);
  assert.equal(totals.members, 6);
  const vol = await desk.req('POST', '/api/admin/participants/import', { csvText, mode: 'confirm' });
  assert.equal(vol.status, 403, 'volunteers cannot import');
  const ok = await admin.req('POST', '/api/admin/participants/import', { csvText, mode: 'confirm' });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  if (ok.json.imported === 0) {
    assert.ok((ok.json.skippedExisting as number) === 4, 'already imported by an earlier run');
  } else {
    assert.equal(ok.json.imported, 4);
  }
  const again = await admin.req('POST', '/api/admin/participants/import', { csvText, mode: 'confirm' });
  assert.equal(again.json.imported, 0);
  const list = await desk.req('GET', '/api/admin/participants');
  const pirates = (list.json.entries as { id: string; entry_number: number; registration_id: string; team_members: { full_name: string; email: string | null; phone: string | null }[] }[])
    .find((e) => e.registration_id === '1001')!;
  assert.ok(pirates.entry_number > 220);
  assert.deepEqual(pirates.team_members.map((m) => m.email).sort(), ['aarav@example.com', 'diya@example.com']);
  entryNumber = pirates.entry_number;
  entryId = pirates.id;
});

test('rotating team PIN: the desk sees it, the participant listing never does', async () => {
  const codes = await desk.req('GET', '/api/admin/team-codes');
  assert.equal(codes.status, 200, JSON.stringify(codes.json));
  pin = (codes.json.codes as Record<string, string>)[String(entryNumber)]!;
  assert.match(pin, /^\d{6}$/);
  const list = await desk.req('GET', '/api/admin/participants');
  assert.ok(!list.text.includes('pin_hash') && !list.text.includes('s1$') && !list.text.includes('s2$'), 'no stored PIN data leaves the server');
});

test('check-in gates login; one device at a time; the desk can release a device', async () => {
  await desk.req('POST', '/api/admin/attendance', { entryId, present: false });
  const blocked = await student.req('POST', '/api/student/login', { entryCode: String(entryNumber), pin: stagingPin(entryNumber) });
  assert.equal(blocked.status, 403);
  const mark = await desk.req('POST', '/api/admin/attendance', { entryId, present: true });
  assert.equal(mark.status, 200);
  const ok = await student.req('POST', '/api/student/login', { entryCode: String(entryNumber), pin: stagingPin(entryNumber) });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  const again = await student.req('POST', '/api/student/login', { entryCode: String(entryNumber), pin: stagingPin(entryNumber) });
  assert.equal(again.status, 200, 'same browser: idempotent');
  const second = await otherDevice.req('POST', '/api/student/login', { entryCode: String(entryNumber), pin: stagingPin(entryNumber) });
  assert.equal(second.status, 409);
  assert.equal((await desk.req('POST', '/api/admin/sessions/release', { entryId })).status, 200);
  assert.equal((await student.req('GET', '/api/student/waiting/state')).status, 401, 'released device is signed out');
  const relog = await student.req('POST', '/api/student/login', { entryCode: String(entryNumber), pin: stagingPin(entryNumber) });
  assert.equal(relog.status, 200);
  const hb = await student.req('POST', '/api/student/heartbeat', { visible: true });
  assert.equal(hb.status, 200);
  const live = await desk.req('GET', '/api/admin/student-logins');
  const row = (live.json.participants as { entry_number: number; status: string }[]).find((p) => p.entry_number === entryNumber);
  assert.equal(row?.status, 'online');
});

test('full Round 1 journey with pause/resume, final submit, evaluation and results', async () => {
  const start = await admin.req('POST', '/api/admin/round1/control', { action: 'start' });
  assert.equal(start.status, 200, JSON.stringify(start.json));

  for (let position = 1; position <= 4; position++) {
    const st = await student.req('GET', '/api/student/round1/state');
    assert.equal(st.status, 200);
    const current = st.json.currentSubmissionId as string;
    const sub = (st.json.submissions as { id: string; position: number }[]).find((s) => s.id === current)!;
    assert.equal(sub.position, position);

    const save = await student.req('POST', '/api/student/round1/autosave', { submissionId: current, promptText: `My prompt for challenge ${position} with role and format`, aiOutputText: 'output' });
    assert.equal(save.status, 200, JSON.stringify(save.json));

    if (position === 2) {
      assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'pause' })).status, 200);
      const paused = await student.req('POST', '/api/student/round1/autosave', { submissionId: current, promptText: 'x', aiOutputText: '' });
      assert.equal(paused.json.code, 'round_paused');
      assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'resume' })).status, 200);
    }

    const early = await student.req('POST', '/api/student/round1/advance', { submissionId: current });
    assert.equal(early.json.code, 'timer_not_expired');
    await db.query(`update submissions set question_end_at = now() - interval '1 second' where id = $1`, [current]);
    const adv = await student.req('POST', '/api/student/round1/advance', { submissionId: current, promptText: `Final prompt ${position}`, aiOutputText: 'final output' });
    assert.equal(adv.status, 200, JSON.stringify(adv.json));
    assert.equal(adv.json.finalSubmit, position === 4);
    if (position === 4) assert.match(String(adv.json.submissionRef), new RegExp(`^R1-${entryNumber}-`));
  }

  // Required feedback once all four answers are locked.
  const need = await student.req('GET', '/api/student/feedback');
  assert.equal(need.status, 200, JSON.stringify(need.json));
  assert.equal(need.json.required, true);
  const page = await student.req('GET', '/student/waiting');
  assert.ok(page.status === 307 || page.text.includes('your feedback') || page.text.includes('/student/feedback'), `dashboard is gated (got ${page.status})`);
  const bad = await student.req('POST', '/api/student/feedback', { overall: 5, system: 4, management: 4, challengeLevel: 'just_right', joinAgain: 'yes', liked: '' });
  assert.equal(bad.status, 400);
  const fb = await student.req('POST', '/api/student/feedback', { overall: 5, system: 4, management: 3, challengeLevel: 'just_right', joinAgain: 'yes', liked: 'Smooth timer', suggestions: '=HYPERLINK("x")' });
  assert.equal(fb.status, 200, JSON.stringify(fb.json));
  assert.equal(fb.json.stored, true);
  const done = await student.req('GET', '/api/student/feedback');
  assert.equal(done.json.required, false);
  assert.equal(done.json.given, true);
  const list = await admin.req('GET', '/api/admin/feedback');
  const row = (list.json.rows as { entryNumber: number; overall: number; liked: string }[]).find((r) => r.entryNumber === entryNumber);
  assert.ok(row && row.overall === 5 && row.liked === 'Smooth timer');
  const fbCsv = await admin.req('GET', '/api/admin/export?type=feedback');
  assert.equal(fbCsv.status, 200);
  assert.ok(fbCsv.text.includes('Smooth timer') && fbCsv.text.includes(`'=HYPERLINK`), 'feedback CSV, formula-safe');

  const stop = await admin.req('POST', '/api/admin/round1/control', { action: 'stop' });
  assert.equal(stop.status, 200);
  const early = await admin.req('POST', '/api/admin/results', { qualificationPercent: 15 });
  assert.equal(early.json.code, 'pending_evaluations');

  for (let i = 0; i < 40; i++) {
    const run = await admin.req('POST', '/api/admin/evaluations', { action: 'run' });
    assert.equal(run.status, 200, JSON.stringify(run.json));
    if (run.json.remaining === 0) break;
    if (run.json.claimed === 0) await new Promise((r) => setTimeout(r, 5000));
  }
  const evals = await admin.req('GET', '/api/admin/evaluations');
  assert.equal((evals.json.counts as Record<string, number>).queued, 0);

  const results = await admin.req('POST', '/api/admin/results', { qualificationPercent: 15, force: true });
  assert.equal(results.status, 200, JSON.stringify(results.json));
  const board = await admin.req('GET', '/api/admin/results');
  const mine = (board.json.results as { score: number; entry: { entry_number: number } }[]).find((r) => r.entry.entry_number === entryNumber);
  assert.ok(mine && Number(mine.score) > 0, 'entry has a non-zero computed score');
  const qCsv = await admin.req('GET', '/api/admin/export?type=qualifiers');
  assert.equal(qCsv.status, 200);
  assert.ok(qCsv.text.includes('Member 1 phone') && qCsv.text.includes('Round 1 rank'), 'qualified-teams CSV has contact columns');

  const detail = await admin.req('GET', `/api/admin/entries/${entryId}/round1`);
  const ps = detail.json.ps as { submission: { prompt_text: string; status: string }; aiEval: { model: string } | null }[];
  assert.deepEqual(ps.map((p) => p.submission.prompt_text), ['Final prompt 1', 'Final prompt 2', 'Final prompt 3', 'Final prompt 4']);
  assert.ok(ps.every((p) => p.submission.status === 'submitted' && p.aiEval));
});

test('logout ends the student session everywhere', async () => {
  assert.equal((await student.req('POST', '/api/auth/logout')).status, 200);
  assert.equal((await student.req('GET', '/api/student/waiting/state')).status, 401);
});
