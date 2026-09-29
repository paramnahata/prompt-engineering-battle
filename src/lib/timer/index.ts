/**
 * All timer state lives in Postgres (rounds.round_start_at / round_end_at,
 * submissions.question_start_at / question_end_at). The browser NEVER
 * computes a deadline on its own — it only renders a countdown from a
 * deadline the server handed it, resynced against the server clock.
 *
 * Client usage pattern:
 *   1. GET /api/student/round1/state -> { serverNow, questionEndAt }
 *   2. Compute offset = serverNow - Date.now() once.
 *   3. Local countdown = questionEndAt - (Date.now() + offset).
 *   4. Re-fetch from the server periodically (e.g. every 20-30s) or on
 *      reconnect/visibility-change, never trusting a long-lived client
 *      timer in isolation.
 */

export interface TimerWindow {
  startAt: Date;
  endAt: Date;
}

export function secondsRemaining(endAt: Date, serverNow: Date = new Date()): number {
  return Math.max(0, Math.floor((endAt.getTime() - serverNow.getTime()) / 1000));
}

export function isExpired(endAt: Date, serverNow: Date = new Date()): boolean {
  return serverNow.getTime() >= endAt.getTime();
}

/** Applies an admin time-extension to an end timestamp, returning the new value. */
export function extendDeadline(endAt: Date, extraSeconds: number): Date {
  return new Date(endAt.getTime() + extraSeconds * 1000);
}

/**
 * Round-level deadline accounting for pauses: total elapsed = wall clock
 * elapsed minus any time spent paused. Used when computing "true" round
 * end after PAUSE/RESUME admin actions.
 */
export function effectiveRoundEnd(
  roundStartAt: Date,
  plannedDurationSeconds: number,
  totalPausedSeconds: number
): Date {
  return new Date(
    roundStartAt.getTime() + (plannedDurationSeconds + totalPausedSeconds) * 1000
  );
}

export function formatMMSS(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
