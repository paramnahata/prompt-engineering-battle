import { supabaseAdmin } from '@/lib/supabase/server';
import {
  evaluateBatch,
  GeminiConfigError,
  GeminiRateLimitError,
  GeminiTransientError,
  RUBRIC_VERSION,
  type EvalInput,
} from '@/lib/gemini/evaluator';

/**
 * Evaluation queue worker.
 *
 * Jobs are claimed atomically in SQL (`claim_evaluation_jobs`, FOR UPDATE
 * SKIP LOCKED), so two workers — the admin dashboard runner and a cron, or
 * two admin tabs — can never evaluate (or pay for) the same submission
 * twice. Jobs stuck in "processing" (worker died) are reclaimed after 3 min.
 * Retries use next_attempt_at backoff instead of sleeping in the function.
 */

export const MAX_RETRIES = 4;
/**
 * Requests per minute we allow ourselves (free tier is roughly 5–15 RPM per
 * model). Calls are spaced evenly instead of sent in bursts. A rate-limit
 * reply never fails a job: it goes back to the queue and is retried later.
 */
const GEMINI_RPM = Math.max(1, Math.min(600, Number(process.env.GEMINI_RPM ?? 8) || 8));
const MIN_GAP_MS = Math.ceil(60_000 / GEMINI_RPM);
let lastCallAt = 0;
async function pace() {
  const wait = lastCallAt + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

export interface RateLimitPause { waitSeconds: number; daily: boolean; message: string }
function pauseFrom(err: GeminiRateLimitError): RateLimitPause {
  const wait = err.info.retryAfterSeconds ?? (err.info.daily ? 900 : 30);
  return { waitSeconds: Math.max(5, Math.min(err.info.daily ? 6 * 3600 : 120, wait)), daily: err.info.daily, message: err.message };
}

export function backoffSeconds(kind: 'rate_limit' | 'transient', retryCount: number): number {
  const base = kind === 'rate_limit' ? 15 : 5;
  return Math.min(120, base * 2 ** retryCount);
}

/** Safe, credential-free error text for storage and the admin UI. */
export function describeError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted]').slice(0, 300);
}

interface ClaimedJob { id: string; submission_id: string; retry_count: number }
interface LoadedJob { job: ClaimedJob; entryId: string | null; input: EvalInput }

async function loadJob(job: ClaimedJob): Promise<LoadedJob> {
  const db = supabaseAdmin();
  const { data: submission, error: subErr } = await db
    .from('submissions')
    .select('id, entry_id, prompt_text, ai_output_text, assignment:challenge_assignments(challenge_snapshot, challenge:challenges(problem_statement, instructions, constraints, evaluation_criteria, prompt_word_limit))')
    .eq('id', job.submission_id)
    .single();
  if (subErr || !submission) throw new Error('Submission not found');
  const assignment = Array.isArray(submission.assignment) ? submission.assignment[0] : submission.assignment;
  // Evaluate against the challenge exactly as it was assigned (later pool edits don't change scoring).
  const live = assignment && (Array.isArray(assignment.challenge) ? assignment.challenge[0] : assignment.challenge);
  const snap = (assignment?.challenge_snapshot ?? null) as Record<string, unknown> | null;
  const challenge = snap?.problem_statement
    ? {
        problem_statement: String(snap.problem_statement),
        instructions: (snap.instructions as string | null) ?? null,
        constraints: (snap.constraints as string | null) ?? null,
        evaluation_criteria: (snap.evaluation_criteria as string | null) ?? null,
        prompt_word_limit: Number(snap.prompt_word_limit) || null,
      }
    : live;
  if (!challenge) throw new Error('Challenge not found for submission');
  return {
    job, entryId: (submission as { entry_id?: string | null }).entry_id ?? null,
    input: {
      problem: challenge.problem_statement,
      instructions: challenge.instructions,
      constraintsText: challenge.constraints,
      evaluationCriteria: challenge.evaluation_criteria,
      promptWordLimit: challenge.prompt_word_limit,
      prompt: submission.prompt_text ?? '',
      aiOutput: submission.ai_output_text ?? '',
    },
  };
}

async function failOrRetry(job: ClaimedJob, err: unknown): Promise<'retry' | 'failed'> {
  const db = supabaseAdmin();
  const nextRetry = job.retry_count + 1;
  const kind = err instanceof GeminiTransientError ? 'transient' : null;
  const retryable = kind !== null && nextRetry < MAX_RETRIES && !(err instanceof GeminiConfigError);
  await db.from('evaluation_jobs').update({
    status: retryable ? 'queued' : 'failed',
    retry_count: nextRetry,
    last_error: describeError(err),
    next_attempt_at: new Date(Date.now() + (kind ? backoffSeconds(kind, job.retry_count) : 0) * 1000).toISOString(),
  }).eq('id', job.id).eq('status', 'processing');
  return retryable ? 'retry' : 'failed';
}

/** Puts jobs back in the queue without counting an attempt (rate limit, or the run ran out of time). */
async function requeue(jobs: ClaimedJob[], afterSeconds: number, note: string | null) {
  if (!jobs.length) return;
  await supabaseAdmin().from('evaluation_jobs').update({
    status: 'queued', next_attempt_at: new Date(Date.now() + afterSeconds * 1000).toISOString(),
    ...(note ? { last_error: note.slice(0, 300) } : {}),
  }).in('id', jobs.map((j) => j.id)).eq('status', 'processing');
}

async function storeResult(job: ClaimedJob, result: Awaited<ReturnType<typeof evaluateBatch>> extends Map<string, infer R> ? R : never) {
  const db = supabaseAdmin();
  const { error: upErr } = await db.from('ai_evaluations').upsert({
    submission_id: job.submission_id,
    prompt_clarity: result.prompt_clarity,
    context: result.context,
    specificity: result.specificity,
    creativity: result.creativity,
    constraint_handling: result.constraint_handling,
    total: result.total,
    originality_score: result.originality_score,
    plagiarism_flag: result.plagiarism_flag,
    flags: result.flags,
    summary: result.summary,
    raw_model_response: result.raw,
    model: result.model,
    rubric_version: result.rubric_version,
    evaluated_at: new Date().toISOString(),
  }, { onConflict: 'submission_id' });
  if (upErr) throw new Error('Could not store the evaluation');
  await db.from('evaluation_jobs').update({
    status: 'completed', evaluated_at: new Date().toISOString(), last_error: null,
    model: result.model, rubric_version: RUBRIC_VERSION,
  }).eq('id', job.id).eq('status', 'processing');
}

/**
 * Processes queued jobs until the queue is empty or the time budget runs out
 * (keeps well under the serverless timeout). All of a team's answers that are
 * claimed together are scored with ONE Gemini request, and requests are
 * spaced to GEMINI_RPM. On a rate limit the run stops and reports how long to
 * wait; nothing is marked failed because of a rate limit.
 */
export async function processEvaluationQueue(options: { timeBudgetMs?: number; maxJobs?: number; claimSize?: number } = {}) {
  const timeBudgetMs = options.timeBudgetMs ?? 40_000;
  const maxJobs = options.maxJobs ?? 200;
  const claimSize = options.claimSize ?? 4;
  const started = Date.now();
  const totals = { claimed: 0, completed: 0, retry: 0, failed: 0 };
  let rateLimited: RateLimitPause | null = null;
  const db = supabaseAdmin();
  // Leave room for one more Gemini call (25 s timeout) plus the pacing gap.
  const hasTime = () => Date.now() - started < timeBudgetMs - 26_000 - MIN_GAP_MS;

  while ((hasTime() || totals.claimed === 0) && !rateLimited && totals.claimed < maxJobs) {
    const { data: jobs, error } = await db.rpc('claim_evaluation_jobs', {
      p_limit: Math.min(claimSize, maxJobs - totals.claimed),
      p_max_retries: MAX_RETRIES,
    });
    if (error) throw new Error('Could not claim evaluation jobs');
    const claimed = (jobs ?? []) as ClaimedJob[];
    if (claimed.length === 0) break;
    totals.claimed += claimed.length;

    // Load and group by team.
    const groups = new Map<string, LoadedJob[]>();
    for (const job of claimed) {
      try {
        const l = await loadJob(job);
        const key = l.entryId ?? job.id;
        groups.set(key, [...(groups.get(key) ?? []), l]);
      } catch (err) {
        totals[await failOrRetry(job, err)] += 1;
      }
    }
    // Complete each team: also take that team's other queued answers, so one request scores all of them.
    // The status check in the UPDATE keeps this exclusive even with two runners.
    const entryIds = [...groups.keys()].filter((k) => groups.get(k)![0]!.entryId === k);
    if (entryIds.length) {
      const { data: subs } = await db.from('submissions').select('id').in('entry_id', entryIds).limit(1000);
      const have = new Set(claimed.map((j) => j.submission_id));
      const others = (subs ?? []).map((x) => x.id as string).filter((id) => !have.has(id));
      if (others.length) {
        const { data: extra } = await db.from('evaluation_jobs')
          .update({ status: 'processing', started_at: new Date().toISOString() })
          .eq('status', 'queued').lte('next_attempt_at', new Date().toISOString()).in('submission_id', others)
          .select('id, submission_id, retry_count');
        for (const job of (extra ?? []) as ClaimedJob[]) {
          totals.claimed += 1;
          try {
            const l = await loadJob(job);
            const key = l.entryId ?? job.id;
            groups.set(key, [...(groups.get(key) ?? []), l]);
          } catch (err) {
            totals[await failOrRetry(job, err)] += 1;
          }
        }
      }
    }
    const pending = [...groups.values()];
    while (pending.length) {
      const group = pending.shift()!;
      if (rateLimited || (!hasTime() && totals.completed + totals.retry + totals.failed > 0)) {
        await requeue(group.map((g) => g.job), 0, null);
        totals.claimed -= group.length;
        continue;
      }
      const needsCall = group.some((g) => g.input.prompt.trim());
      if (needsCall) await pace();
      try {
        const results = await evaluateBatch(group.map((g) => ({ id: g.job.id, input: g.input })));
        for (const g of group) {
          const r = results.get(g.job.id);
          if (r) { await storeResult(g.job, r); totals.completed += 1; }
          else totals[await failOrRetry(g.job, new GeminiTransientError('The AI reply did not include this answer; it will be retried'))] += 1;
        }
      } catch (err) {
        if (err instanceof GeminiRateLimitError) {
          rateLimited = pauseFrom(err);
          await requeue(group.map((g) => g.job), rateLimited.waitSeconds, rateLimited.message);
          totals.retry += group.length;
        } else {
          for (const g of group) totals[await failOrRetry(g.job, err)] += 1;
        }
      }
    }
  }
  return { ...totals, rateLimited };
}

// ---------------------------------------------------------------------
// Round 2 queue (same claiming / retry semantics as Round 1)
// ---------------------------------------------------------------------
interface ClaimedRound2Job { id: string; entry_id: string; retry_count: number }
let round2Pause: RateLimitPause | null = null;

async function processRound2One(job: ClaimedRound2Job): Promise<'completed' | 'retry' | 'failed'> {
  const db = supabaseAdmin();
  try {
    const [{ data: state, error: sErr }, { data: asg }] = await Promise.all([
      db.from('round2_states').select('initial_prompt, initial_output, final_prompt, final_output, rationale, twist_snapshot').eq('entry_id', job.entry_id).single(),
      db.from('round2_assignments').select('problem_snapshot').eq('entry_id', job.entry_id).maybeSingle(),
    ]);
    if (sErr || !state) throw new Error('Round 2 work not found');
    const { evaluateRound2, ROUND2_RUBRIC_VERSION } = await import('@/lib/gemini/round2');
    const r = await evaluateRound2({
      problem: (asg?.problem_snapshot ?? null) as Record<string, unknown> | null,
      twist: (state.twist_snapshot ?? null) as Record<string, unknown> | null,
      initialPrompt: state.initial_prompt ?? '', initialOutput: state.initial_output ?? '',
      finalPrompt: state.final_prompt ?? '', finalOutput: state.final_output ?? '', rationale: state.rationale ?? '',
    });
    const { error: upErr } = await db.from('round2_ai_evaluations').upsert({
      entry_id: job.entry_id,
      problem_understanding: r.problem_understanding, prompt_structure: r.prompt_structure, context_specificity: r.context_specificity,
      creativity: r.creativity, constraint_handling: r.constraint_handling, output_quality: r.output_quality,
      ai_subtotal: r.ai_subtotal, summary: r.summary, raw_model_response: { ...r.raw, flags: r.flags },
      model: r.model, rubric_version: ROUND2_RUBRIC_VERSION, evaluated_at: new Date().toISOString(),
    }, { onConflict: 'entry_id' });
    if (upErr) throw new Error('Could not store the evaluation');
    await db.from('round2_eval_jobs').update({ status: 'completed', evaluated_at: new Date().toISOString(), last_error: null })
      .eq('id', job.id).eq('status', 'processing');
    return 'completed';
  } catch (err) {
    if (err instanceof GeminiRateLimitError) {
      const p = pauseFrom(err);
      await db.from('round2_eval_jobs').update({
        status: 'queued', last_error: describeError(err), next_attempt_at: new Date(Date.now() + p.waitSeconds * 1000).toISOString(),
      }).eq('id', job.id).eq('status', 'processing');
      round2Pause = p;
      return 'retry';
    }
    const nextRetry = job.retry_count + 1;
    const kind = err instanceof GeminiTransientError ? 'transient' : null;
    const retryable = kind !== null && nextRetry < MAX_RETRIES && !(err instanceof GeminiConfigError);
    await db.from('round2_eval_jobs').update({
      status: retryable ? 'queued' : 'failed', retry_count: nextRetry, last_error: describeError(err),
      next_attempt_at: new Date(Date.now() + (kind ? backoffSeconds(kind, job.retry_count) : 0) * 1000).toISOString(),
    }).eq('id', job.id).eq('status', 'processing');
    return retryable ? 'retry' : 'failed';
  }
}

/** Round 2: one finalist per request, spaced to GEMINI_RPM; stops (without failing anything) on a rate limit. */
export async function processRound2Queue(options: { timeBudgetMs?: number } = {}) {
  const timeBudgetMs = options.timeBudgetMs ?? 40_000;
  const started = Date.now();
  const totals = { claimed: 0, completed: 0, retry: 0, failed: 0 };
  const db = supabaseAdmin();
  round2Pause = null;
  while ((Date.now() - started < timeBudgetMs - 26_000 - MIN_GAP_MS || totals.claimed === 0) && !round2Pause) {
    const { data: jobs, error } = await db.rpc('claim_round2_eval_jobs', { p_limit: 1, p_max_retries: MAX_RETRIES });
    if (error) throw error;
    const claimed = (jobs ?? []) as ClaimedRound2Job[];
    if (claimed.length === 0) break;
    totals.claimed += claimed.length;
    await pace();
    for (const job of claimed) totals[await processRound2One(job)] += 1;
  }
  return { ...totals, rateLimited: round2Pause };
}
