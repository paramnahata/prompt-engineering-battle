import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ExcelJS from 'exceljs';
import { parseChallengeSheets, normalizeDifficulty, normalizeCode } from '@/lib/challenges/import';
import { readWorkbook } from '@/lib/challenges/read-workbook';

/** Builds an .xlsx in memory shaped like the organisers' workbook. */
async function syntheticWorkbook() {
  const wb = new ExcelJS.Workbook();
  const task = wb.addWorksheet('Task');
  task.addRow(['Member', 'Year', 'Role', 'Responsibility']);
  task.addRow(['Someone', 'TY', 'Prompt Creator', 'Logic — 100']);
  const a = wb.addWorksheet('Author A');
  a.addRow(['PS ID:', 'Category:', 'Difficulty:', 'Challenge Prompt:', 'Expected Output:', 'Evaluation Criteria:', '', 'Distribution', 'Categories']);
  a.addRow(['LOG-001', 'Logical Reasoning', 'Easy', 'Solve the boxes puzzle', 'Pick from Mixed', 'Correctness', '', '1 to 25', 'Logic']);
  a.addRow(['BUS -002', 'logical reasoning', 'Mid', 'Plan a cafe menu', 'Five ideas', 'Relevance']);
  a.addRow(['LOG-003', 'Logical Reasoning', 'HARD', 'Knights and knaves', 'Answer', 'Correctness']);
  a.addRow([null, null, null, null, null, null, '', '26 to 50', 'Puzzles']);
  const b = wb.addWorksheet('Author B');
  b.addRow(['PS ID:', 'Category:', 'Difficulty:', 'Challenge Prompt:', 'Expected Output:', 'Evaluation Criteria:']);
  b.addRow(['CRW-001', 'Creative writing', 'Expert', 'Write a JSON adventure', 'JSON', 'Validity']);
  b.addRow(['CRW-002', 'Creative writing', '', 'Write a poem', 'Poem', '']);
  b.addRow(['LOG-001', 'Creative writing', 'Hard', 'Duplicate id', 'x', 'y']);
  b.addRow(['CRW-003', 'Creative writing', 'Medium', '', 'x', 'y']);
  b.addRow(['CRW-004', 'Creative writing', 'Spicy', 'Odd difficulty', 'x', 'y']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

test('reads every sheet, skips summary sheets and side tables, maps "PS ID:"-style headers', async () => {
  const buf = await syntheticWorkbook();
  const sheets = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const r = parseChallengeSheets(sheets);
  assert.deepEqual(r.sheets.map((s) => [s.name, s.used]), [['Task', false], ['Author A', true], ['Author B', true]]);
  assert.deepEqual(r.challenges.map((c) => c.challenge_code), ['LOG-001', 'BUS-002', 'LOG-003', 'CRW-001', 'CRW-002', 'CRW-004']);
  assert.deepEqual(r.challenges.map((c) => c.difficulty), ['easy', 'medium', 'hard', 'expert', 'unrated', 'unrated']);
  assert.equal(r.challenges[1]!.category, 'Logical Reasoning', 'case-only category variants unified to the most common spelling');
  assert.equal(r.challenges[0]!.title, 'Logical Reasoning · LOG-001', 'title derived when the sheet has none');
  assert.equal(r.challenges[0]!.source_ref, 'Author A · row 2');
  const errs = r.errors.map((e) => e.message).join('\n');
  assert.match(errs, /Duplicate PS ID LOG-001 \(first used at Author A · row 2\)/);
  assert.match(errs, /CRW-003 has no problem statement/);
  const warns = r.warnings.map((w) => w.message).join('\n');
  assert.match(warns, /"BUS -002" normalised to "BUS-002"/);
  assert.match(warns, /CRW-002 has no difficulty — imported as "unrated"/);
  assert.match(warns, /difficulty "Spicy" not recognised/);
  assert.deepEqual(r.difficultyCounts, { easy: 1, medium: 1, hard: 1, expert: 1, unrated: 2 });
});

test('admin mapping overrides and sheet exclusion are applied', () => {
  const sheets = [{ name: 'S', rows: [['Ref', 'Question text', 'Lvl'], ['Q-1', 'Do X', 'hard']] }];
  assert.equal(parseChallengeSheets(sheets).challenges.length, 0, 'unknown headers are not guessed');
  const r = parseChallengeSheets(sheets, { mapping: { challenge_code: 'Ref', problem_statement: 'Question text', difficulty: 'Lvl' } });
  assert.deepEqual(r.challenges.map((c) => [c.challenge_code, c.difficulty]), [['Q-1', 'hard']]);
  assert.equal(parseChallengeSheets(sheets, { mapping: { challenge_code: 'Ref', problem_statement: 'Question text' }, excludedSheets: ['S'] }).challenges.length, 0);
});

test('normalisers', () => {
  for (const [raw, v] of [['EASY', 'easy'], ['Mid', 'medium'], ['MEDIUM', 'medium'], ['medium', 'medium'], ['Hard', 'hard'], ['Expert', 'expert'], ['', 'unrated'], ['?', 'unrated']] as const) {
    assert.equal(normalizeDifficulty(raw).value, v, raw);
  }
  assert.equal(normalizeCode(' bus -001 '), 'BUS-001');
  assert.ok(parseChallengeSheets([{ name: 'S', rows: [['PS ID', 'Prompt'], ['X Y!', 'p']] }]).errors.length === 1);
});

// The organisers' real workbook is not committed. Point PEB_PS_WORKBOOK at it to run this check locally.
const REAL = process.env.PEB_PS_WORKBOOK;
test('the organisers\' "Round 1 Task Allocation" workbook parses into 599 importable PS + 1 duplicate', { skip: !REAL || !fs.existsSync(REAL) }, async () => {
  const buf = fs.readFileSync(REAL!);
  const sheets = await readWorkbook(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
  const r = parseChallengeSheets(sheets);
  assert.equal(r.sheets.find((s) => s.name === 'Task')?.used, false);
  assert.equal(r.sheets.filter((s) => s.used).length, 6);
  assert.equal(r.challenges.length + r.errors.length, 600);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0]!.message, /Duplicate PS ID CRW-034/);
  console.log('    real workbook:', JSON.stringify(r.difficultyCounts), Object.keys(r.categoryCounts).length, 'categories,', r.warnings.length, 'warnings');
});
