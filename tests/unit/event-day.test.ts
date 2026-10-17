import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPasteLikeChange, MAX_TYPED_BURST } from '@/lib/client/no-paste';
import { hideProblemCodes, stripLeadingId } from '@/lib/student/hide-codes';
import { parseParticipantsCsv } from '@/lib/csv/import';
import { diffEntry } from '@/lib/csv/update-existing';

const ev = (inputType: string, data: string | null = null) => ({ inputType, data }) as unknown as Event;

test('typing-only fields: paste, drop and keyboard clipboard inserts are rejected; typing is not', () => {
  assert.equal(isPasteLikeChange('ab', 'abc', ev('insertText', 'c')), false);
  assert.equal(isPasteLikeChange('Write a ', 'Write a summary ', ev('insertText', 'summary ')), false, 'swipe typing inserts a word');
  assert.equal(isPasteLikeChange('teh', 'the', ev('insertReplacementText', 'the')), false, 'autocorrect');
  assert.equal(isPasteLikeChange('abc', 'ab', ev('deleteContentBackward')), false);
  assert.equal(isPasteLikeChange('', 'x', ev('insertFromPaste', 'x')), true);
  assert.equal(isPasteLikeChange('', 'x', ev('insertFromDrop')), true);
  const chunk = 'You are an expert assistant. Write a detailed plan for the launch.';
  assert.equal(isPasteLikeChange('', chunk, ev('insertText', chunk)), true, 'Gboard clipboard chip = insertText with a long chunk');
  assert.equal(isPasteLikeChange('a', 'a' + 'x'.repeat(MAX_TYPED_BURST + 1), undefined), true, 'large jump without event info');
  assert.equal(isPasteLikeChange('a'.repeat(100), 'b'.repeat(90), ev('insertText', 'b'.repeat(90))), true, 'replace-all by pasting');
});

test('students never see problem IDs', () => {
  assert.equal(stripLeadingId('CRW-003: Creative writting'), 'Creative writting');
  assert.equal(stripLeadingId('P04 - Manufacturing Bottleneck'), 'Manufacturing Bottleneck');
  assert.equal(stripLeadingId('Pricing Under Rising Costs'), 'Pricing Under Rising Costs');
  assert.equal(stripLeadingId('CRW-003'), 'CRW-003', 'never blanks a title');
  const out = hideProblemCodes({
    ok: true, code: 'top-level-status-stays',
    assignments: [{ position: 1, challenge: { title: 'CRW-016: Ads', challenge_code: 'CRW-016', problem_statement: 'x' } }],
    problem: { code: 'P02', problem_code: 'P02', title: 'P02: Shelf allocation', statement: 'y' },
  });
  const text = JSON.stringify(out);
  assert.ok(!text.includes('CRW-016') && !text.includes('P02'), text);
  assert.equal((out as { code: string }).code, 'top-level-status-stays');
  assert.equal(out.assignments[0]!.challenge.title, 'Ads');
});

const HEADER = 'SR.NO,ID ,NAMES,Team Name,PHONE NO:  ,E-MAIL,GENDER,COLLEGE,CITY,BRANCH,YEAR,DATE/TIME\n';

test('a team ID copied by mistake onto the next team does not merge or block the import', () => {
  const csv = HEADER
    + '1,5001,Asha Rao,,9000000001,,FEMALE,JNEC,CSN,CSE,,\n,,Bina Rao,,-,,FEMALE,JNEC,CSN,CSE,,\n'
    + '2,5001,Chetan Das,,9000000003,,MALE,JNEC,CSN,AIDS,,\n,,Dev Das,,-,,MALE,JNEC,CSN,AIDS,,\n'
    + '3,5003,Esha Jain,,9000000005,,FEMALE,JNEC,CSN,CSE,,\n';
  const p = parseParticipantsCsv(csv);
  assert.equal(p.invalidEntries.length, 0, JSON.stringify(p.invalidEntries));
  assert.deepEqual(p.entries.map((e) => [e.registration_id, e.members.map((m) => m.full_name)]), [
    ['5001', ['Asha Rao', 'Bina Rao']], ['5001-2', ['Chetan Das', 'Dev Das']], ['5003', ['Esha Jain']]]);
  assert.ok(p.entries[1]!.warnings.some((w) => w.includes('5001-2')));
  // Same file again → same derived ID (re-upload stays idempotent).
  assert.equal(parseParticipantsCsv(csv).entries[1]!.registration_id, '5001-2');
});

test('a team without an ID keeps the same generated ID when its details are filled in later', () => {
  const before = parseParticipantsCsv(HEADER + '1,,Farah Khan,,,,FEMALE,,,,,\n');
  const after = parseParticipantsCsv(HEADER + '1,,Farah  Khan,Team F,9000000009,farah@example.com,FEMALE,JNEC,CSN,CSE,2-YEAR,\n');
  assert.ok(before.entries[0]!.registration_id_generated);
  assert.equal(before.entries[0]!.registration_id, after.entries[0]!.registration_id);
});

test('re-upload diff: fills blanks and changes, adds a missing member, never erases', () => {
  const stored = {
    id: 'e1', registration_id: '5001', team_name: null,
    members: [{ id: 'm1', entry_id: 'e1', member_position: 1, full_name: 'Asha Rao', email: null, phone: '9000000001', gender: 'FEMALE', college: 'JNEC', city: 'CSN', branch: 'CSE', study_year: null }],
  };
  const incoming = parseParticipantsCsv(HEADER
    + '1,5001,Asha Rao,Team A,,asha@example.com,FEMALE,JNEC,CSN,CSE,3-YEAR,\n,,Bina Rao,,9000000002,bina@example.com,FEMALE,JNEC,CSN,CSE,3-YEAR,\n').entries[0]!;
  const u = diffEntry(stored, incoming)!;
  assert.equal(u.teamName, 'Team A');
  assert.deepEqual(u.memberPatches, [{ memberId: 'm1', patch: { email: 'asha@example.com', study_year: '3-YEAR' } }], 'blank phone in the sheet does not erase the stored phone');
  assert.equal(u.newMembers.length, 1);
  assert.equal(u.newMembers[0]!.full_name, 'Bina Rao');
  assert.equal(u.memberCount, 2);
  const same = parseParticipantsCsv(HEADER + '1,5001,Asha Rao,,9000000001,,FEMALE,JNEC,CSN,CSE,,\n').entries[0]!;
  assert.equal(diffEntry(stored, same), null, 'unchanged sheet → nothing to update');
});

test('placeholder cells ("-", "NA") are blank: no "-" IDs, emails or phones', () => {
  const p = parseParticipantsCsv(HEADER + '1,-,Gita Rao,Team G,9000000011,-,FEMALE,JNEC,CSN,CSE,-,-\n,,Hari Rao,,-,NA,MALE,JNEC,CSN,CSE,-,-\n');
  const e = p.entries[0]!;
  assert.ok(e.registration_id_generated, 'ID "-" → generated ID');
  assert.deepEqual(e.members.map((m) => [m.email, m.phone, m.study_year]), [['', '9000000011', ''], ['', '', '']]);
});
