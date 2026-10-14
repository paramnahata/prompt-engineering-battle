import { supabaseAdmin } from '@/lib/supabase/server';
import {
  evaluateSubmission,
  GeminiConfigError,
  GeminiRateLimitError,
  GeminiTransientError,
  RUBRIC_VERSION,
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
const DEFAULT_CONCURRENCY = Math.max(1, Math.min(8, Number(process.env.GEMINI_CONCURRENCY ?? 4) || 4));

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

async function processOne(job: ClaimedJob): Promise<'completed' | 'retry' | 'failed'> {
  const db = supabaseAdmin();
  try {
    const { data: submission, error: subErr } = await db
      .from('submissions')
      .select('id, prompt_text, ai_output_text, assignment:challenge_assignments(challenge_snapshot, challenge:challenges(problem_statement, instructions, constraints, evaluation_criteria, prompt_word_limit))')
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

    const result = await evaluateSubmission({
      problem: challenge.problem_statement,
      instructions: challenge.instructions,
      constraintsText: challenge.constraints,
      evaluationCriteria: challenge.evaluation_criteria,
      promptWordLimit: challenge.prompt_word_limit,
      prompt: submission.prompt_text ?? '',
      aiOutput: submission.ai_output_text ?? '',
    });

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
    return 'completed';
  } catch (err) {
    const nextRetry = job.retry_count + 1;
    const kind = err instanceof GeminiRateLimitError ? 'rate_limit' : err instanceof GeminiTransientError ? 'transient' : null;
    const retryable = kind !== null && nextRetry < MAX_RETRIES && !(err instanceof GeminiConfigError);
    await db.from('evaluation_jobs').update({
      status: retryable ? 'queued' : 'failed',
      retry_count: nextRetry,
      last_error: describeError(err),
      next_attempt_at: new Date(Date.now() + (kind ? backoffSeconds(kind, job.retry_count) : 0) * 1000).toISOString(),
    }).eq('id', job.id).eq('status', 'processing');
    return retryable ? 'retry' : 'failed';
  }
}

/**
 * Processes queued jobs with bounded concurrency until the queue is empty
 * or the time budget runs out (keeps well under the serverless timeout).
 */
export async function processEvaluationQueue(options: { timeBudgetMs?: number; concurrency?: number; maxJobs?: number } = {}) {
  const timeBudgetMs = options.timeBudgetMs ?? 40_000;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const maxJobs = options.maxJobs ?? 200;
  const started = Date.now();
  const totals = { claimed: 0, completed: 0, retry: 0, failed: 0 };
  const db = supabaseAdmin();

  // Leave room for one more Gemini call (25s timeout) inside the budget.
  while (Date.now() - started < timeBudgetMs - 26_000 || totals.claimed === 0) {
    if (totals.claimed >= maxJobs) break;
    const { data: jobs, error } = await db.rpc('claim_evaluation_jobs', {
      p_limit: Math.min(concurrency, maxJobs - totals.claimed),
      p_max_retries: MAX_RETRIES,
    });
    if (error) throw new Error('Could not claim evaluation jobs');
    const claimed = (jobs ?? []) as ClaimedJob[];
    if (claimed.length === 0) break;
    totals.claimed += claimed.length;
    const outcomes = await Promise.all(claimed.map(processOne));
    for (const o of outcomes) totals[o] += 1;
    // Stop early if the provider is throttling us; the backoff will spread retries out.
    if (outcomes.every((o) => o === 'retry')) break;
  }
  return totals;
}

// ---------------------------------------------------------------------
// Round 2 queue (same claiming / retry semantics as Round 1)
// ---------------------------------------------------------------------
interface ClaimedRound2Job { id: string; entry_id: string; retry_count: number }

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
    const nextRetry = job.retry_count + 1;
    const kind = err instanceof GeminiRateLimitError ? 'rate_limit' : err instanceof GeminiTransientError ? 'transient' : null;
    const retryable = kind !== null && nextRetry < MAX_RETRIES && !(err instanceof GeminiConfigError);
    await db.from('round2_eval_jobs').update({
      status: retryable ? 'queued' : 'failed', retry_count: nextRetry, last_error: describeError(err),
      next_attempt_at: new Date(Date.now() + (kind ? backoffSeconds(kind, job.retry_count) : 0) * 1000).toISOString(),
    }).eq('id', job.id).eq('status', 'processing');
    return retryable ? 'retry' : 'failed';
  }
}

export async function processRound2Queue(options: { timeBudgetMs?: number; concurrency?: number } = {}) {
  const timeBudgetMs = options.timeBudgetMs ?? 40_000;
  const concurrency = options.concurrency ?? DEFAULT_CONCURRENCY;
  const started = Date.now();
  const totals = { claimed: 0, completed: 0, retry: 0, failed: 0 };
  const db = supabaseAdmin();
  while (Date.now() - started < timeBudgetMs - 26_000 || totals.claimed === 0) {
    const { data: jobs, error } = await db.rpc('claim_round2_eval_jobs', { p_limit: concurrency, p_max_retries: MAX_RETRIES });
    if (error) throw error;
    const claimed = (jobs ?? []) as ClaimedRound2Job[];
    if (claimed.length === 0) break;
    totals.claimed += claimed.length;
    const outcomes = await Promise.all(claimed.map(processRound2One));
    for (const o of outcomes) totals[o] += 1;
    if (outcomes.every((o) => o === 'retry')) break;
  }
  return totals;
}
