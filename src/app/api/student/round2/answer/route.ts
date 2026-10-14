import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { rpcFailure, studentClaims } from '@/lib/auth/student';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ questionId: z.string().uuid(), answer: z.string().trim().min(1).max(4000) });

export async function POST(req: NextRequest) {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 16 * 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('student_round2_answer', {
      p_sid: auth.claims.sid, p_entry: auth.claims.sub, p_question: body.data.questionId, p_answer: body.data.answer,
    });
    if (error) throw error;
    if (!data?.ok) return rpcFailure(data ?? {});
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('round2 answer', err, 'Could not send your answer. Please retry.');
  }
}
