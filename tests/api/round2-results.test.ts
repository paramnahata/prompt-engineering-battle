import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Actor, accessCode, loadStackEnv, stagingPin } from './client';

/**
 * Round 2 + jury + results publication + announcements + exports + reset,
 * end to end over HTTP against the local staging stack (synthetic data).
 */
const env = loadStackEnv();
const PASSWORD = 'Staging-Only-Password-1';
const db = new Pool({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: 'peb_stage' });
const admin = new Actor('admin');
const desk = new Actor('desk');
const judge = new Actor('judge');
const finalist = new Actor('finalist team 77');
const other = new Actor('non-finalist team 78');
const code = () => accessCode(env.EVENT_SECRET!);
let finalistId = '';
let problemId = '';
let twistId = '';

before(async () => {
  await db.query('delete from rate_limits'); // staging only: earlier suites use up the per-IP organizer login allowance
  for (const [a, email] of [[admin, 'admin@staging.local'], [desk, 'desk@staging.local'], [judge, 'judge@staging.local']] as const) {
    const r = await a.req('POST', '/api/organizer/login', { email, password: PASSWORD });
    assert.equal(r.status, 200, JSON.stringify(r.json));
  }
  for (const n of [1, 2]) {
    const st = (await admin.req('GET', '/api/admin/overview')).json.rounds as Record<string, { status: string }>;
    const s = st[`round${n}`]?.status;
    if (s === 'running' || s === 'paused') await admin.req('POST', `/api/admin/round${n}/control`, { action: 'stop' });
  }
  assert.equal((await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' })).status, 200);
  finalistId = (await db.query(`select id from entries where entry_number = 77`)).rows[0].id;
});
after(async () => {
  await db.query(`update entries set present = true where registration_id like 'STG-REG-%'`);
  await db.end();
});

test('health endpoint: public summary only; details for admins', async () => {
  const pub = await new Actor('anon').req('GET', '/api/health');
  assert.equal(pub.status, 200);
  assert.deepEqual(Object.keys(pub.json).sort(), ['checkedAt', 'database', 'ok', 'schemaVersion']);
  const adm = await admin.req('GET', '/api/health');
  assert.ok(Array.isArray(adm.json.missingEnv), 'admins see missing env var NAMES');
  assert.ok(!JSON.stringify(adm.json).includes(env.SESSION_SECRET!), 'never values');
});

test('Round 2 cannot start until settings are saved, finalists chosen and a problem exists', async () => {
  const cfg = await admin.req('GET', '/api/admin/round2/config');
  assert.equal(cfg.status, 200);
  assert.equal((cfg.json.preflight as { ok: boolean }).ok, false);
  const start = await admin.req('POST', '/api/admin/round2/control', { action: 'start' });
  assert.equal(start.status, 409);
  assert.equal(start.json.code, 'preflight_failed');

  const p = await admin.req('POST', '/api/admin/round2/problems', { problem_code: `R2-${Date.now() % 100000}`, title: 'City water planner', problem_statement: 'Plan water rationing.', expected_output: 'PRIVATE-EXPECTED', evaluation_criteria: 'PRIVATE-CRITERIA' });
  assert.equal(p.status, 200, JSON.stringify(p.json));
  problemId = (p.json.problem as { id: string }).id;
  const dup = await admin.req('POST', '/api/admin/round2/problems', { problem_code: (p.json.problem as { problem_code: string }).problem_code, title: 'x', problem_statement: 'y' });
  assert.equal(dup.status, 409, 'duplicate problem IDs are refused');
  const t = await admin.req('POST', '/api/admin/round2/twists', { title: 'Drought', description: 'Half the water.' });
  twistId = (t.json.twist as { id: string }).id;

  const bad = await admin.req('PUT', '/api/admin/round2/config', { durationMinutes: 1 });
  assert.equal(bad.status, 400);
  const save = await admin.req('PUT', '/api/admin/round2/config', {
    durationMinutes: 30, problemMode: 'common', commonProblemId: problemId,
    twist: { enabled: true, mode: 'common', commonTwistId: twistId },
    jury: { enabled: true, criteria: [{ key: 'understanding', label: 'Understanding', max: 10 }, { key: 'response_quality', label: 'Quality', max: 10 }, { key: 'adaptability', label: 'Adaptability', max: 10 }, { key: 'interaction', label: 'Interaction', max: 10 }] },
    ai: { enabled: false, maxPoints: 0 }, limits: { promptWords: 200, outputChars: 4000, rationaleWords: 100 }, final: { round1Weight: 1, round2Weight: 1 },
  });
  assert.equal(save.status, 200, JSON.stringify(save.json));
});

test('finalists from Round 1; volunteers cannot run Round 2 or publish results', async () => {
  // Run a short Round 1 with only teams 77 and 78 checked in; 77 gets the only non-zero score so it alone qualifies.
  await db.query(`update entries set present = (entry_number in (77, 78))`);
  assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'start' })).status, 200);
  assert.equal((await admin.req('POST', '/api/admin/round1/control', { action: 'stop' })).status, 200);
  await db.query(`update evaluation_jobs set status = 'completed'`);
  await db.query(`insert into ai_evaluations (submission_id, prompt_clarity, context, specificity, creativity, constraint_handling, total)
                  select s.id, 8, 8, 8, 8, 8, 40 from submissions s where s.entry_id = $1 on conflict do nothing`, [finalistId]);
  const comp = await admin.req('POST', '/api/admin/results', { qualificationPercent: 50 });
  assert.equal(comp.status, 200, JSON.stringify(comp.json));
  assert.equal(comp.json.qualified, 1);
  const f = await admin.req('POST', '/api/admin/round2/finalists', { action: 'from_round1' });
  assert.equal(f.status, 200, JSON.stringify(f.json));
  assert.equal(f.json.total, 1);
  assert.equal((await desk.req('POST', '/api/admin/round2/control', { action: 'start' })).status, 403);
  assert.equal((await desk.req('PUT', '/api/admin/results/publication', { scope: 'round1', settings: { published: true } })).status, 403);
  assert.equal((await judge.req('PUT', '/api/admin/results/publication', { scope: 'round1', settings: { published: true } })).status, 403);
});

test('Round 1 results stay hidden until published, then follow the visibility settings', async () => {
  const c = code();
  assert.equal((await finalist.req('POST', '/api/student/login', { entryCode: '77', pin: stagingPin(77), accessCode: c })).status, 200);
  assert.equal((await other.req('POST', '/api/student/login', { entryCode: '78', pin: stagingPin(78), accessCode: c })).status, 200);
  let r = await finalist.req('GET', '/api/student/results');
  assert.deepEqual(r.json.round1, { published: false });
  const pub = await admin.req('PUT', '/api/admin/results/publication', { scope: 'round1', settings: { published: true, showScore: true, showRank: true, showFeedback: false, showLeaderboard: true, leaderboardSize: 3 } });
  assert.equal(pub.status, 200, JSON.stringify(pub.json));
  r = await finalist.req('GET', '/api/student/results');
  const r1 = r.json.round1 as { score: number; rank: number; qualified: boolean; leaderboard: unknown[]; challenges: { feedback: unknown }[] };
  assert.equal(Number(r1.score), 160);
  assert.equal(r1.rank, 1);
  assert.equal(r1.qualified, true);
  assert.equal(r1.leaderboard.length, 2, 'two ranked teams, leaderboard size 3');
  assert.ok(r1.challenges.every((x) => x.feedback === null), 'feedback hidden unless enabled');
  const o = await other.req('GET', '/api/student/results');
  assert.equal((o.json.round1 as { qualified: boolean }).qualified, false);
  assert.ok(!o.text.includes('pin_hash') && !o.text.includes('PRIVATE-'));
});

test('targeted announcements reach only their audience; projector shows only public ones', async () => {
  const mk = (audience: string, message: string, entryNumbers?: number[]) => admin.req('POST', '/api/admin/announcements', { audience, message, entryNumbers });
  assert.equal((await mk('round2', 'Finalists: go to hall B')).status, 200);
  assert.equal((await mk('entries', 'Team 78: see the desk', [78])).status, 200);
  assert.equal((await mk('entries', 'nobody', [99999])).status, 400, 'unknown entry numbers are rejected');
  const fin = await finalist.req('GET', '/api/student/dashboard');
  const msgsF = (fin.json.announcements as { message: string }[]).map((a) => a.message);
  assert.ok(msgsF.includes('Finalists: go to hall B') && !msgsF.includes('Team 78: see the desk'));
  const oth = await other.req('GET', '/api/student/dashboard');
  const msgsO = (oth.json.announcements as { message: string }[]).map((a) => a.message);
  assert.ok(msgsO.includes('Team 78: see the desk') && !msgsO.includes('Finalists: go to hall B'));
  const display = await desk.req('GET', '/api/display/stats');
  assert.ok(!display.text.includes('hall B') && !display.text.includes('see the desk'), 'targeted messages never reach the projector');
});

test('full Round 2: stages, privacy, twist, jury Q&A and scoring, stop, final results, publication', async () => {
  const start = await admin.req('POST', '/api/admin/round2/control', { action: 'start' });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const st = await finalist.req('GET', '/api/student/round2/state');
  assert.equal(st.status, 200);
  assert.equal(st.json.state, 'INITIAL_PROMPT');
  assert.ok(!st.text.includes('PRIVATE-'), 'expected output and criteria never reach students');
  const not = await other.req('GET', '/api/student/round2/state');
  assert.equal(not.json.eligible, false);
  assert.equal((await other.req('POST', '/api/student/round2/save', { action: 'save', fields: { initialPrompt: 'x' } })).status, 403);

  assert.equal((await finalist.req('POST', '/api/student/round2/save', { action: 'save', fields: { initialPrompt: 'Plan rationing by district', initialOutput: 'out' } })).status, 200);
  assert.equal((await finalist.req('POST', '/api/student/round2/save', { action: 'save', fields: { initialPrompt: 'word '.repeat(250) } })).status, 400, 'word limit');
  assert.equal((await finalist.req('POST', '/api/student/round2/save', { action: 'submit_initial', fields: {} })).json.state, 'OUTPUT');

  const q = await judge.req('POST', '/api/jury/questions', { entryId: finalistId, question: 'How do you handle hospitals?' });
  assert.equal(q.status, 200, JSON.stringify(q.json));
  const st2 = await finalist.req('GET', '/api/student/round2/state');
  const qid = (st2.json.questions as { id: string }[])[0]!.id;
  assert.equal((await other.req('POST', '/api/student/round2/answer', { questionId: qid, answer: 'hijack' })).status, 404, 'cannot answer another team’s question');
  assert.equal((await finalist.req('POST', '/api/student/round2/answer', { questionId: qid, answer: 'They are exempt.' })).status, 200);

  assert.equal((await admin.req('POST', '/api/admin/round2/control', { action: 'reveal_twist' })).json.revealed, 1);
  const st3 = await finalist.req('GET', '/api/student/round2/state');
  assert.equal((st3.json.twist as { title: string }).title, 'Drought');
  assert.equal((await finalist.req('POST', '/api/student/round2/save', { action: 'save', fields: { finalPrompt: 'Adapted for drought', finalOutput: 'final', rationale: 'Water halved' } })).status, 200);
  const [s1, s2] = await Promise.all([1, 2].map(() => finalist.req('POST', '/api/student/round2/save', { action: 'submit_final', fields: {} })));
  assert.equal(s1!.json.submissionRef, s2!.json.submissionRef, 'retries produce one reference');

  const detail = await judge.req('GET', `/api/jury/teams/${finalistId}`);
  assert.equal(detail.status, 200);
  assert.ok(detail.text.includes('PRIVATE-EXPECTED'), 'the jury does see the expected output');
  assert.equal((await admin.req('PUT', '/api/jury/scores', { entryId: finalistId, scores: { understanding: 5 } })).status, 403, 'admins override, judges score');
  assert.equal((await judge.req('PUT', '/api/jury/scores', { entryId: finalistId, scores: { understanding: 11 } })).status, 400);
  const sc = await judge.req('PUT', '/api/jury/scores', { entryId: finalistId, scores: { understanding: 8, response_quality: 7, adaptability: 9, interaction: 6 }, lock: true });
  assert.equal(sc.status, 200, JSON.stringify(sc.json));
  assert.equal((await judge.req('PUT', '/api/jury/scores', { entryId: finalistId, scores: { understanding: 1 } })).json.code, 'locked');

  assert.equal((await admin.req('POST', '/api/admin/round2/control', { action: 'stop' })).status, 200);
  const comp = await admin.req('POST', '/api/admin/results/final', { force: false });
  assert.equal(comp.status, 200, JSON.stringify(comp.json));
  const fin = await admin.req('GET', '/api/admin/results/final');
  const row = (fin.json.results as { entry_id: string; round1_score: number; round2_score: number; final_score: number; rank: number }[]).find((x) => x.entry_id === finalistId)!;
  assert.equal(Number(row.round2_score), 30);
  assert.equal(Number(row.final_score), 190);

  assert.deepEqual((await finalist.req('GET', '/api/student/results')).json.final, { published: false });
  await admin.req('PUT', '/api/admin/results/publication', { scope: 'final', settings: { published: true, showLeaderboard: false } });
  const res = await finalist.req('GET', '/api/student/results');
  assert.equal((res.json.final as { rank: number }).rank, 1);
  assert.equal(Number((res.json.final as { finalScore: number }).finalScore), 190);
});

test('CSV exports: admin only, formula-safe, never contain PINs or hashes', async () => {
  assert.equal((await desk.req('GET', '/api/admin/export?type=participants')).status, 403);
  for (const type of ['participants', 'final_results', 'jury_scores', 'round2_work', 'audit_log']) {
    const r = await admin.req('GET', `/api/admin/export?type=${type}`);
    assert.equal(r.status, 200, type);
    assert.match(r.headers.get('content-type') ?? '', /text\/csv/);
    assert.ok(!/s[12]\$[\w-]+\$/.test(r.text), `${type} contains no PIN hashes`);
  }
  const csv = (await admin.req('GET', '/api/admin/export?type=participants')).text;
  assert.ok(!csv.includes(stagingPin(77)), 'no plaintext PINs');
  assert.equal((await admin.req('GET', '/api/admin/export?type=secrets')).status, 400);
});

test('reset preview lists what is cleared and kept; reset clears both rounds and unpublishes', async () => {
  const p = await admin.req('GET', '/api/admin/competition/reset');
  assert.equal(p.status, 200);
  assert.ok(Number((p.json.clear as Record<string, number>).round2Finalists) >= 1);
  assert.ok(Number((p.json.keep as Record<string, number>).withPin) >= 220);
  const r = await admin.req('POST', '/api/admin/competition/reset', { confirm: 'RESET COMPETITION' });
  assert.equal(r.status, 200);
  const res = await finalist.req('GET', '/api/student/results');
  assert.deepEqual(res.json, { ok: true, round1: { published: false }, final: { published: false } });
  const cfg = await admin.req('GET', '/api/admin/round2/config');
  assert.equal(((cfg.json.preflight as { config: { confirmed: boolean } }).config).confirmed, true, 'Round 2 settings survive a reset');
});
