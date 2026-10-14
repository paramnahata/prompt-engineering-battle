import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { jsonError } from '@/lib/http';

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert', 'unrated'] as const;
export const POOL_STATUSES = ['approved', 'review', 'test', 'archived'] as const;

const text = (max: number) => z.string().trim().max(max);
export const challengeFieldsSchema = z.object({
  challenge_code: z.string().trim().min(1).max(40).transform((s) => s.replace(/\s+/g, '').toUpperCase())
    .refine((s) => /^[A-Z0-9][A-Z0-9_.\-/]{0,39}$/.test(s), 'Use letters, digits, - _ . / only'),
  title: text(200).optional(),
  category: text(120).optional(),
  difficulty: z.enum(DIFFICULTIES),
  problem_statement: z.string().trim().min(1).max(10_000),
  expected_output: text(10_000).optional(),
  evaluation_criteria: text(10_000).optional(),
  instructions: text(10_000).optional(),
  constraints: text(10_000).optional(),
  prompt_word_limit: z.number().int().min(10).max(2000),
  output_char_limit: z.number().int().min(100).max(50_000),
  pool_status: z.enum(['approved', 'review', 'test']),
  active: z.boolean().optional(),
});

export function toRow(d: Partial<z.infer<typeof challengeFieldsSchema>>) {
  const row: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d)) {
    if (v === undefined) continue;
    row[k] = typeof v === 'string' && v === '' && k !== 'problem_statement' ? null : v;
  }
  if (d.challenge_code && !d.title) row.title = `${d.category || 'Challenge'} · ${d.challenge_code}`;
  return row;
}

/** Pool changes are refused while a round is running or paused. */
export async function poolLockedResponse(db: SupabaseClient) {
  const { data, error } = await db.from('rounds').select('round_number, status').in('status', ['running', 'paused']);
  if (error) throw error;
  if (data && data.length) {
    return jsonError(`Round ${data[0]!.round_number} is ${data[0]!.status}. Stop it before changing the challenge pool (assigned challenges are snapshotted and never change).`, 409, { code: 'round_active' });
  }
  return null;
}

/** Strip characters that have meaning inside a PostgREST or() filter. */
export function safeSearch(q: string | null): string {
  return (q ?? '').replace(/[,()*%\\:"']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}
