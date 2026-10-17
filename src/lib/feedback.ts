import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Round 1 feedback form (one per team), required once the team's Round 1 answers are locked. */
export const feedbackSchema = z.object({
  overall: z.number().int().min(1).max(5),
  system: z.number().int().min(1).max(5),
  management: z.number().int().min(1).max(5),
  challengeLevel: z.enum(['too_easy', 'just_right', 'too_hard']),
  joinAgain: z.enum(['yes', 'maybe', 'no']),
  liked: z.string().trim().min(2, 'Tell us one thing you liked.').max(1000),
  suggestions: z.string().trim().max(2000).optional().default(''),
});
export type FeedbackInput = z.infer<typeof feedbackSchema>;

/** Postgres "undefined table": the 0009 migration has not been applied yet. Never block students on that. */
export const isMissingTable = (err: unknown) => (err as { code?: string } | null)?.code === '42P01' || /round1_feedback/.test(String((err as { message?: string })?.message ?? '')) && /does not exist|schema cache/i.test(String((err as { message?: string })?.message ?? ''));

/**
 * Feedback is required when the team has finished Round 1 (no draft answers
 * left and at least one locked/submitted) and has not given feedback yet.
 */
export async function feedbackStatus(db: SupabaseClient, entryId: string): Promise<{ required: boolean; given: boolean; available: boolean }> {
  const fb = await db.from('round1_feedback').select('entry_id').eq('entry_id', entryId).maybeSingle();
  if (fb.error) {
    if (isMissingTable(fb.error)) return { required: false, given: false, available: false };
    throw fb.error;
  }
  if (fb.data) return { required: false, given: true, available: true };
  const { data: subs, error } = await db.from('submissions').select('status').eq('entry_id', entryId);
  if (error) throw error;
  const rows = subs ?? [];
  const finished = rows.length > 0 && rows.every((s) => s.status !== 'draft');
  return { required: finished, given: false, available: true };
}
