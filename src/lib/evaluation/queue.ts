import { supabaseAdmin } from '@/lib/supabase/server';
import {
  evaluateSubmission,
  GeminiRateLimitError,
  GeminiTransientError,
} from '@/lib/gemini/evaluator';

const MAX_CONCURRENCY = 5; // never fire 80+ Gemini calls at once
const MAX_RETRIES = 4;
const BASE_BACKOFF_MS = 1500;

/**
 * Enqueues an evaluation_jobs row for a submission (idempotent via the
 * unique constraint on submission_id — call this right after final submit).
 */
export async function enqueueEvaluation(submissionId: string) {
  const db = supabaseAdmin();
  await db
    .from('evaluation_jobs')
    .upsert({ submission_id: submissionId, status: 'queued' }, { onConflict: 'submission_id' });
}

/**
 * Processes up to `batchSize` queued jobs with bounded concurrency.
 * Intended to be invoked by a Vercel Cron route (e.g. every 10-15s during
 * the evaluation window) rather than run continuously — see
 * src/app/api/cron/process-evaluations/route.ts.
 */
export async function processEvaluationQueue(batchSize = 20) {
  const db = supabaseAdmin();

  const { data: jobs, error } = await db
    .from('evaluation_jobs')
    .select('id, submission_id, retry_count')
    .eq('status', 'queued')
    .lt('retry_count', MAX_RETRIES)
    .order('queued_at', { ascending: true })
    .limit(batchSize);
  if (error) throw error;
  if (!jobs || jobs.length === 0) return { processed: 0 };

  let cursor = 0;
  let processed = 0;

  async function worker() {
    while (cursor < jobs!.length) {
      const job = jobs![cursor++]!;
      await processOne(job.id, job.submission_id, job.retry_count);
      processed++;
    }
  }

  const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, jobs.length) }, worker);
  await Promise.all(workers);

  return { processed };
}

async function processOne(jobId: string, submissionId: string, retryCount: number) {
  const db = supabaseAdmin();

  await db
    .from('evaluation_jobs')
    .update({ status: 'processing', started_at: new Date().toISOString() })
    .eq('id', jobId);

  try {
    const { data: submission, error: subErr } = await db
      .from('submissions')
      .select('id, prompt_text, ai_output_text, assignment_id')
      .eq('id', submissionId)
      .single();
    if (subErr || !submission) throw subErr ?? new Error('submission not found');

    const { data: assignment, error: asgErr } = await db
      .from('challenge_assignments')
      .select('challenge_id')
      .eq('id', submission.assignment_id)
      .single();
    if (asgErr || !assignment) throw asgErr ?? new Error('assignment not found');

    const { data: challenge, error: chErr } = await db
      .from('challenges')
      .select('problem_statement, instructions, constraints')
      .eq('id', assignment.challenge_id)
      .single();
    if (chErr || !challenge) throw chErr ?? new Error('challenge not found');

    const result = await evaluateSubmission({
      problem: challenge.problem_statement,
      instructions: challenge.instructions,
      constraintsText: challenge.constraints,
      prompt: submission.prompt_text,
      aiOutput: submission.ai_output_text,
    });

    await db.from('ai_evaluations').upsert(
      {
        submission_id: submissionId,
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
        evaluated_at: new Date().toISOString(),
      },
      { onConflict: 'submission_id' }
    );

    await db
      .from('evaluation_jobs')
      .update({ status: 'completed', evaluated_at: new Date().toISOString() })
      .eq('id', jobId);
  } catch (err) {
    const isRateLimit = err instanceof GeminiRateLimitError;
    const isTransient = err instanceof GeminiTransientError || isRateLimit;
    const nextRetry = retryCount + 1;
    const willRetry = isTransient && nextRetry < MAX_RETRIES;

    if (willRetry) {
      const backoffMs = BASE_BACKOFF_MS * 2 ** retryCount;
      await new Promise((r) => setTimeout(r, backoffMs));
      await db
        .from('evaluation_jobs')
        .update({
          status: 'queued',
          retry_count: nextRetry,
          last_error: String(err instanceof Error ? err.message : err),
        })
        .eq('id', jobId);
    } else {
      await db
        .from('evaluation_jobs')
        .update({
          status: 'failed',
          retry_count: nextRetry,
          last_error: String(err instanceof Error ? err.message : err),
        })
        .eq('id', jobId);
    }
  }
}
