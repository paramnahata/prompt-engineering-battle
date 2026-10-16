import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parseParticipantsCsv, normalizePhone } from '@/lib/csv/import';

const fixture = (name: string) => fs.readFileSync(path.join(__dirname, '..', 'fixtures', name), 'utf8');

test('groups merged-cell team rows and keeps each member\'s own contact details', () => {
  const p = parseParticipantsCsv(fixture('participants-merged.csv'));
  assert.deepEqual(p.fileErrors, []);
  assert.equal(p.headerRow, 3, 'skips the title rows above the header');
  assert.equal(p.entries.length, 4);

  const [pirates, kabir, comma, solo] = p.entries;
  assert.equal(pirates!.registration_id, '1001');
  assert.equal(pirates!.team_name, 'Prompt Pirates');
  assert.equal(pirates!.members.length, 2);
  assert.deepEqual(pirates!.members.map((m) => [m.full_name, m.email, m.phone]), [
    ['Aarav Sharma', 'aarav@example.com', '9876543210'],
    ['Diya Patil', 'diya@example.com', '+919123456789'],
  ]);
  // Group-level college/city are inherited, personal fields are not.
  assert.equal(pirates!.members[1]!.college, 'JNEC');
  assert.equal(pirates!.members[1]!.branch, 'IT');
  assert.equal(pirates!.members[1]!.gender, 'F');

  assert.equal(kabir!.members.length, 1);
  assert.equal(kabir!.team_name, '');

  assert.equal(comma!.team_name, 'Team, Comma', 'quoted field with a comma');
  assert.equal(comma!.members[0]!.full_name, 'Meera "Mo" Nair', 'escaped quotes');
  assert.equal(comma!.members[1]!.full_name, 'Rohan Das');
  assert.equal(comma!.members[1]!.phone, '', 'missing phone is not copied from a teammate');
  assert.ok(comma!.warnings.some((w) => w.includes('Rohan Das has no phone')));

  assert.equal(solo!.members[0]!.email, '', 'missing email stays missing');
  assert.equal(p.invalidEntries.length, 0);
});

test('handles a UTF-8 BOM and Windows line endings', () => {
  const p = parseParticipantsCsv(fixture('participants-bom-crlf.csv'));
  assert.deepEqual(p.fileErrors, []);
  assert.equal(p.entries.length, 1);
  assert.equal(p.entries[0]!.registration_id, '2001');
  assert.deepEqual(p.entries[0]!.members.map((m) => m.email), ['anaya@example.com', 'vivaan@example.com']);
});

test('supports wide sheets with member-2 columns and generates stable IDs when there is no ID column', () => {
  const a = parseParticipantsCsv(fixture('participants-wide.csv'));
  const b = parseParticipantsCsv(fixture('participants-wide.csv'));
  assert.equal(a.entries.length, 2);
  assert.deepEqual(a.entries[0]!.members.map((m) => [m.full_name, m.email, m.phone]), [
    ['Sara Khan', 'sara@example.com', '9333333333'],
    ['Omar Ali', 'omar@example.com', '9444444444'],
  ]);
  assert.equal(a.entries[1]!.members.length, 1);
  assert.ok(a.entries[0]!.registration_id_generated);
  assert.equal(a.entries[0]!.registration_id, b.entries[0]!.registration_id, 'synthetic IDs are deterministic → re-import is idempotent');
  assert.notEqual(a.entries[0]!.registration_id, a.entries[1]!.registration_id);
});

test('an ID reused by a non-adjacent block gets a derived ID and a warning (does not block the import); oversize teams are errors', () => {
  const csv = 'ID,NAMES,Team Name\n1,A,T1\n2,B,T2\n1,C,T3\n9,D,Big\n,E,\n,F,\n,G,\n,H,\n';
  const p = parseParticipantsCsv(csv);
  const dup = p.entries.find((e) => e.members[0]?.full_name === 'C')!;
  assert.equal(dup.errors.length, 0);
  assert.equal(dup.registration_id, '1-2');
  assert.ok(dup.warnings.some((w) => w.includes('also used')));
  const big = p.entries.find((e) => e.team_name === 'Big')!;
  assert.equal(big.members.length, 5);
  assert.ok(big.errors.some((e) => e.includes('maximum team size')));
});

test('same team ID repeated on every member row is one entry', () => {
  const p = parseParticipantsCsv('SR.NO,ID,NAMES\n1,77,A\n2,77,B\n3,78,C\n');
  assert.equal(p.entries.length, 2);
  assert.deepEqual(p.entries[0]!.members.map((m) => m.full_name), ['A', 'B']);
});

test('rejects files without a name column, binary content and oversize input', () => {
  assert.ok(parseParticipantsCsv('foo,bar\n1,2\n').fileErrors.length > 0);
  assert.ok(parseParticipantsCsv('NAMES\nA\u0000\n').fileErrors.length > 0);
  assert.ok(parseParticipantsCsv('x'.repeat(2 * 1024 * 1024 + 1)).fileErrors.length > 0);
});

test('column mapping overrides are applied; unknown headers ignored', () => {
  const csv = 'Who,Mail\nAsha,asha@example.com\n';
  assert.ok(parseParticipantsCsv(csv).fileErrors.length > 0);
  const p = parseParticipantsCsv(csv, { full_name: 'Who', email: 'Mail', phone: 'Nope' });
  assert.equal(p.entries[0]!.members[0]!.email, 'asha@example.com');
  assert.equal(p.mapping.phone, undefined);
});

test('phone normalisation keeps + and digits only', () => {
  assert.equal(normalizePhone(' +91 (987) 654-3210 '), '+919876543210');
  assert.equal(normalizePhone(''), '');
  assert.equal(normalizePhone('9.87654321E+09'), '9.87654321E+09', 'scientific notation is left for a human to fix');
});
