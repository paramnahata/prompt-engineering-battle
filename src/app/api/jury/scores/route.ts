import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const n = z.number().finite().min(0).max(100).optional();
const criteriaScores = z.object({ understanding: n, response_quality: n, adaptability: n, interaction: n }).strict();
// Question mode: the question the judge asked (their own or a suggested one) and its mark.
const questionScores = z.object({
  questions: z.array(z.object({
    question: z.string().trim().min(1).max(500),
    mark: z.number().finite().min(0).max(100),
    source: z.enum(['own', 'suggested']).default('own'),
  }).strict()).min(1).max(10),
}).strict();
const bodySchema = z.object({
  entryId: z.string().uuid(),
  scores: z.union([questionScores, criteriaScores]),
  notes: z.string().max(4000).optional(),
  lock: z.boolean().default(false),
});

/** A judge saves (and optionally locks) their own score — per criterion or per question, as set in Round 2 settings; limits are checked in SQL. */
export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(['judge']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 16 * 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('jury_save_score', {
      p_judge: auth.session.userId, p_entry: body.data.entryId, p_scores: body.data.scores,
      p_notes: body.data.notes ?? null, p_lock: body.data.lock,
    });
    if (error) throw error;
    return rpcResponse(data, 'Could not save the score.');
  } catch (err) {
    return serverError('jury score', err, 'Could not save the score.');
  }
}
