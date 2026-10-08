import { supabaseAdmin } from '@/lib/supabase/server';

/**
 * Generates Round 1 challenge assignments for every PRESENT, non-disqualified
 * entry that doesn't already have an assignment for this round. Idempotent:
 * safe to call again after a page reload — entries that already have
 * assignments are skipped entirely, so re-running never regenerates them.
 *
 * Layout per entry (position 1-4):
 *   1: common challenge A
 *   2: common challenge B
 *   3: randomized (load-balanced across the active pool)
 *   4: randomized (load-balanced, distinct from position 3 for this entry)
 */
export async function generateRound1Assignments(roundId: string) {
  const db = supabaseAdmin();

  const { data: entries, error: entriesErr } = await db
    .from('entries')
    .select('id')
    .eq('present', true)
    .eq('disqualified', false);
  if (entriesErr) throw entriesErr;

  const { data: existing, error: existingErr } = await db
    .from('challenge_assignments')
    .select('entry_id')
    .eq('round_id', roundId);
  if (existingErr) throw existingErr;
  const alreadyAssigned = new Set((existing ?? []).map((r) => r.entry_id));

  const pending = (entries ?? []).filter((e) => !alreadyAssigned.has(e.id));
  if (pending.length === 0) {
    return { assigned: 0, skipped: entries?.length ?? 0 };
  }

  const { data: pool, error: poolErr } = await db
    .from('challenges')
    .select('id')
    .eq('active', true);
  if (poolErr) throw poolErr;
  if (!pool || pool.length < 4) {
    throw new Error('Need at least 4 active challenges (2 common + pool for randomized).');
  }

  // First two active challenges (by insertion) act as the common pair —
  // admin controls this by activating/ordering the intended common ones first,
  // or by using event_settings to pin explicit challenge_codes (see README).
  const commonA = pool[0]!.id;
  const commonB = pool[1]!.id;
  const randomPool = pool.slice(2).map((p) => p.id);
  if (randomPool.length === 0) {
    throw new Error('Not enough challenges left for the randomized slots.');
  }

  // Load-balance: track how many times each challenge has been used so far
  // in THIS run, spreading assignments evenly across the pool.
  const usageCount = new Map<string, number>(randomPool.map((id) => [id, 0]));

  function pickBalanced(excludeId?: string): string {
    let best: string | null = null;
    let bestCount = Infinity;
    for (const id of randomPool) {
      if (id === excludeId) continue;
      const c = usageCount.get(id)!;
      if (c < bestCount) {
        bestCount = c;
        best = id;
      }
    }
    const chosen = best ?? randomPool[0];
    usageCount.set(chosen, (usageCount.get(chosen) ?? 0) + 1);
    return chosen;
  }

  const rows: {
    entry_id: string;
    round_id: string;
    challenge_id: string;
    position: number;
    is_common: boolean;
  }[] = [];

  for (const entry of pending) {
    const c3 = pickBalanced();
    const c4 = pickBalanced(c3);
    rows.push(
      { entry_id: entry.id, round_id: roundId, challenge_id: commonA, position: 1, is_common: true },
      { entry_id: entry.id, round_id: roundId, challenge_id: commonB, position: 2, is_common: true },
      { entry_id: entry.id, round_id: roundId, challenge_id: c3, position: 3, is_common: false },
      { entry_id: entry.id, round_id: roundId, challenge_id: c4, position: 4, is_common: false }
    );
  }

  const { error: insertErr } = await db.from('challenge_assignments').insert(rows);
  if (insertErr) throw insertErr;

  // Create the (empty, draft) submission rows so autosave has a target.
  const { data: inserted, error: fetchErr } = await db
    .from('challenge_assignments')
    .select('id, entry_id')
    .eq('round_id', roundId)
    .in('entry_id', pending.map((e) => e.id));
  if (fetchErr) throw fetchErr;

  const submissionRows = (inserted ?? []).map((a) => ({
    assignment_id: a.id,
    entry_id: a.entry_id,
  }));
  if (submissionRows.length > 0) {
    const { error: subErr } = await db.from('submissions').insert(submissionRows);
    if (subErr) throw subErr;
  }

  return { assigned: pending.length, skipped: alreadyAssigned.size };
}
