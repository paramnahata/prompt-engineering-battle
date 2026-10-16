import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.SESSION_SECRET = process.env.SESSION_SECRET ?? 'unit-test-session-secret-0123456789abcdef';

test('team PINs: 6 digits, differ per team, change every 60 s; previous PIN accepted only in the first 30 s', async () => {
  const { currentTeamCodes, isTeamCodeValid, teamCodeFor, teamCodeKey, teamCodeWindow, TEAM_CODE_SECONDS, TEAM_CODE_GRACE_SECONDS } = await import('@/lib/auth/team-code');
  assert.equal(TEAM_CODE_SECONDS, 60);
  const start = Math.ceil(Date.now() / 60_000) * 60_000 + 5 * 60_000; // start of a future minute
  const k = teamCodeKey();
  const w = teamCodeWindow(start);
  const now = teamCodeFor(7, w, k);
  const prev = teamCodeFor(7, w - 1, k);
  assert.match(now, /^\d{6}$/);
  const { codes, changesAt } = currentTeamCodes([7, 8, 9], start + 1000);
  assert.equal(codes[7], now);
  assert.equal(new Set(Object.values(codes)).size, 3, 'different teams get different PINs');
  assert.equal(new Date(changesAt).getTime(), start + 60_000);
  assert.ok(isTeamCodeValid(7, now, start + 59_000));
  assert.ok(isTeamCodeValid(7, ` ${now} `, start + 1000));
  if (prev !== now) {
    assert.ok(isTeamCodeValid(7, prev, start + (TEAM_CODE_GRACE_SECONDS - 1) * 1000), 'grace period');
    assert.ok(!isTeamCodeValid(7, prev, start + (TEAM_CODE_GRACE_SECONDS + 1) * 1000), 'expired after grace');
  }
  if (teamCodeFor(8, w, k) !== now) assert.ok(!isTeamCodeValid(8, now, start + 1000), 'one team’s PIN does not open another team');
  for (const bad of ['', '12345', '1234567', 'abcdef']) assert.ok(!isTeamCodeValid(7, bad, start + 1000), bad);
  assert.notEqual(teamCodeFor(7, w, teamCodeKey({ SESSION_SECRET: 'another-secret-another-secret-12345' })), now, 'depends on the server secret');
});
