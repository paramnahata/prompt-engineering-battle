import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { Pool } from 'pg';
import { Actor, accessCode, loadStackEnv, stagingPin } from './client';

/**
 * Round 2 event format over HTTP against the local staging stack (synthetic
 * data): problem-pack import, one problem per team, per-problem twist, jury
 * marks per question with suggested questions, and the declared winners.
 */
const env = loadStackEnv();
const PASSWORD = 'Staging-Only-Password-1';
const db = new Pool({ host: process.env.PGHOST ?? '/tmp', port: Number(process.env.PGPORT ?? 54329), user: 'postgres', database: 'peb_stage' });
const admin = new Actor('admin');
const desk = new Actor('desk');
const judge = new Actor('judge');
const teamA = new Actor('team 81');
const teamB = new Actor('team 82');
const stamp = Date.now() % 100000;
const code = (n: number) => `PK${stamp}-${n}`;
let idA = '';
let idB = '';

const pack = [1, 2, 3].map((n) => ({
  problem_code: code(n), title: `Pack problem ${n}`, category: 'Operations', difficulty: 'Hard',
  problem_statement: `Statement ${n}: a bakery sells 300 cakes at ₹1,250.`, twist_description: `VARIANT-${n}: price is now ₹349.`,
  sample_prompt: `JURY-SAMPLE-${n}`, expected_output: `JURY-SOLUTION-${n}`, evaluation_criteria: 'Rubric',
}));

before(async () => {
  await db.query('delete from rate_limits');
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
  idA = (await db.query(`select id from entries where entry_number = 81`)).rows[0].id;
  idB = (await db.query(`select id from entries where entry_number = 82`)).rows[0].id;
});
after(async () => {
  await db.query(`update round2_problems set active = false where problem_code like 'PK%'`);
  await db.end();
});

test('problem pack import: admin only, validated, inserts then updates by code, can disable other problems', async () => {
  assert.equal((await desk.req('POST', '/api/admin/round2/problems/import', { problems: pack })).status, 403);
  assert.equal((await judge.req('POST', '/api/admin/round2/problems/import', { problems: pack })).status, 403);
  assert.equal((await admin.req('POST', '/api/admin/round2/problems/import', { problems: [pack[0], pack[0]] })).status, 400, 'duplicate codes');
  assert.equal((await admin.req('POST', '/api/admin/round2/problems/import', { problems: [{ ...pack[0], title: '' }] })).status, 400);
  assert.equal((await admin.req('POST', '/api/admin/round2/problems/import', { problems: [] })).status, 400);
  assert.equal((await admin.req('POST', '/api/admin/round2/problems/import', { problems: pack, extra: 1 })).status, 400, 'unknown fields refused');

  const r = await admin.req('POST', '/api/admin/round2/problems/import', { problems: pack, disableOthers: true });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.created, 3);
  assert.equal(r.json.active, 3, 'only the pack is active');
  const again = await admin.req('POST', '/api/admin/round2/problems/import', { problems: pack.map((p) => ({ ...p, problem_code: p.problem_code.toLowerCase() })) });
  assert.deepEqual([again.json.created, again.json.updated], [0, 3], 're-import updates by code, case-insensitively');
  const list = await admin.req('GET', '/api/admin/round2/problems');
  const p1 = (list.json.problems as { problem_code: string; twist_description: string; sample_prompt: string }[]).find((p) => p.problem_code === code(1).toUpperCase());
  assert.equal(p1?.twist_description, pack[0]!.twist_description);
  assert.equal(p1?.sample_prompt, 'JURY-SAMPLE-1');
});

test('event format: one problem per team, own twist on reveal, private fields never reach students', async () => {
  const save = await admin.req('PUT', '/api/admin/round2/config', {
    durationMinutes: 25, problemMode: 'random', commonProblemId: null,
    twist: { enabled: true, mode: 'problem', commonTwistId: null },
    jury: { enabled: true, mode: 'questions', questionCount: 5, questionMax: 10, criteria: [{ key: 'understanding', label: 'U', max: 10 }, { key: 'response_quality', label: 'Q', max: 10 }, { key: 'adaptability', label: 'A', max: 10 }, { key: 'interaction', label: 'I', max: 10 }] },
    ai: { enabled: false, maxPoints: 50 }, limits: { promptWords: 200, outputChars: 4000, rationaleWords: 100 }, final: { round1Weight: 0, round2Weight: 1 },
  });
  assert.equal(save.status, 200, JSON.stringify(save.json));
  const add = await admin.req('POST', '/api/admin/round2/finalists', { action: 'add', entryNumbers: [81, 82] });
  assert.equal(add.status, 200, JSON.stringify(add.json));
  const start = await admin.req('POST', '/api/admin/round2/control', { action: 'start' });
  assert.equal(start.status, 200, JSON.stringify(start.json));
  const asg = await db.query(`select entry_id, problem_snapshot ->> 'problem_code' code from round2_assignments`);
  assert.equal(asg.rows.length, 2);
  assert.notEqual(asg.rows[0].code, asg.rows[1].code, 'the two teams got different problems');

  const c = accessCode(env.EVENT_SECRET!);
  assert.equal((await teamA.req('POST', '/api/student/login', { entryCode: '81', pin: stagingPin(81), accessCode: c })).status, 200);
  assert.equal((await teamB.req('POST', '/api/student/login', { entryCode: '82', pin: stagingPin(82), accessCode: c })).status, 200);
  let st = await teamA.req('GET', '/api/student/round2/state');
  assert.equal(st.status, 200);
  assert.equal(st.json.twist, null);
  assert.ok(!/VARIANT-|JURY-SAMPLE|JURY-SOLUTION/.test(JSON.stringify(st.json)), 'nothing private before the reveal');
  assert.equal((await teamA.req('POST', '/api/student/round2/save', { action: 'submit_initial', fields: { initialPrompt: 'Act as a pricing analyst. Compare options.', initialOutput: 'Option table…' } })).status, 200);

  assert.equal((await desk.req('POST', '/api/admin/round2/control', { action: 'reveal_twist' })).status, 403);
  const rv = await admin.req('POST', '/api/admin/round2/control', { action: 'reveal_twist' });
  assert.equal(rv.json.revealed, 2);
  st = await teamA.req('GET', '/api/student/round2/state');
  const myCode = asg.rows.find((x) => x.entry_id === idA).code as string;
  const n = Number(myCode.split('-').pop());
  assert.equal((st.json.twist as { description: string }).description, `VARIANT-${n}: price is now ₹349.`, 'team A sees its own problem’s variant');
  assert.ok(!/JURY-SAMPLE|JURY-SOLUTION/.test(JSON.stringify(st.json)));
  assert.equal((await teamA.req('POST', '/api/student/round2/save', { action: 'submit_final', fields: { finalPrompt: 'Act as a pricing analyst for cookies at ₹349.', finalOutput: 'Updated table', rationale: 'We changed the product and price.' } })).status, 200);
});

test('jury: phone view data with suggested questions; marks per question; students cannot reach jury endpoints', async () => {
  assert.equal((await teamA.req('GET', `/api/jury/teams/${idA}`)).status, 403);
  assert.equal((await teamA.req('POST', `/api/jury/teams/${idA}/suggest`, {})).status, 403);
  assert.equal((await desk.req('GET', `/api/jury/teams/${idA}`)).status, 403);
  const d = await judge.req('GET', `/api/jury/teams/${idA}`);
  assert.equal(d.status, 200);
  const sug = d.json.suggestions as { id: string; text: string }[];
  assert.ok(sug.length >= 5);
  assert.ok(sug.some((s) => s.id === 'twist' && s.text.includes('₹349')), 'suggestions use this team’s twist');
  assert.ok(String((d.json.problem as { sample_prompt: string }).sample_prompt).startsWith('JURY-SAMPLE-'), 'jury sees the reference');
  const board = await judge.req('GET', '/api/jury/teams');
  assert.equal((board.json.jury as { mode: string }).mode, 'questions');

  const q = (k: number, mark = 8) => Array.from({ length: k }, (_, i) => ({ question: `Question ${i + 1}?`, mark, source: 'own' }));
  assert.equal((await judge.req('PUT', '/api/jury/scores', { entryId: idA, scores: { questions: q(6) } })).status, 400);
  assert.equal((await judge.req('PUT', '/api/jury/scores', { entryId: idA, scores: { questions: [{ question: 'x?', mark: 11 }] } })).status, 400);
  assert.equal((await judge.req('PUT', '/api/jury/scores', { entryId: idA, scores: { questions: q(3) }, lock: true })).status, 400, 'lock needs every question');
  assert.equal((await admin.req('PUT', '/api/jury/scores', { entryId: idA, scores: { questions: q(5) } })).status, 403, 'only judges score');
  const ok = await judge.req('PUT', '/api/jury/scores', { entryId: idA, scores: { questions: [...q(4, 9), { question: sug[0]!.text, mark: 7, source: 'suggested' }] }, notes: 'Clear answers', lock: true });
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.total, 43);
  assert.equal(ok.json.max, 50);
  const okB = await judge.req('PUT', '/api/jury/scores', { entryId: idB, scores: { questions: q(5, 5) }, lock: true });
  assert.equal(okB.status, 200);
  const detail = await admin.req('GET', `/api/jury/teams/${idA}`);
  const mine = (detail.json.scores as { question_scores: { question: string; source: string }[] }[])[0]!;
  assert.equal(mine.question_scores.length, 5);
  assert.equal(mine.question_scores[4]!.source, 'suggested');
  const csv = await admin.req('GET', '/api/admin/export?type=jury_scores');
  assert.match(csv.text, /Q5 \[7\]/);
});

test('winners: Round 2 decides, published winners appear on the projector and the team’s results', async () => {
  assert.equal((await admin.req('POST', '/api/admin/round2/control', { action: 'stop' })).status, 200);
  const comp = await admin.req('POST', '/api/admin/results/final', { force: false });
  assert.equal(comp.status, 200, JSON.stringify(comp.json));
  const fr = await admin.req('GET', '/api/admin/results/final');
  const rows = fr.json.results as { rank: number; final_score: number; round2_jury: number; entry: { entry_number: number } }[];
  assert.deepEqual(rows.map((r) => [r.entry.entry_number, Number(r.round2_jury), Number(r.final_score), r.rank]), [[81, 43, 43, 1], [82, 25, 25, 2]]);

  assert.deepEqual((await desk.req('GET', '/api/display/stats')).json.winners, [], 'nothing on the projector before publishing');
  assert.equal((await admin.req('PUT', '/api/admin/results/publication', { scope: 'final', settings: { published: true, showScore: true } })).status, 200);
  const display = await desk.req('GET', '/api/display/stats');
  const winners = display.json.winners as { rank: number; entryNumber: number; score: number }[];
  assert.deepEqual(winners.map((w) => [w.rank, w.entryNumber, w.score]), [[1, 81, 43], [2, 82, 25]]);
  const res = await teamA.req('GET', '/api/student/results');
  assert.equal((res.json.final as { rank: number }).rank, 1);
});
