import { hideProblemCodes } from '@/lib/student/hide-codes';
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { rpcFailure, studentClaims } from '@/lib/auth/student';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  submissionId: z.string().uuid(),
  // Latest editor contents, so nothing typed after the last autosave is lost.
  promptText: z.string().max(20_000).optional(),
  aiOutputText: z.string().max(20_000).optional(),
});

/**
 * Locks the current challenge (positions 1-3) or final-submits all four
 * (position 4). Idempotent and race-safe: the SQL function locks the row.
 * Students cannot advance before the challenge timer ends.
 */
export async function POST(req: NextRequest) {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 128 * 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('student_advance', {
      p_sid: auth.claims.sid,
      p_entry: auth.claims.sub,
      p_submission: body.data.submissionId,
      p_prompt: body.data.promptText ?? null,
      p_output: body.data.aiOutputText ?? null,
    });
    if (error) throw error;
    if (!data?.ok) return rpcFailure(data ?? {});
    return jsonOk(hideProblemCodes(data));
  } catch (err) {
    return serverError('advance', err, 'Could not submit this challenge. Retrying…');
  }
}
