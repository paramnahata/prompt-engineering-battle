import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { rpcFailure, studentClaims } from '@/lib/auth/student';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const text = z.string().max(60_000).optional();
const bodySchema = z.object({
  action: z.enum(['save', 'submit_initial', 'submit_final']),
  fields: z.object({
    initialPrompt: text, initialOutput: text, finalPrompt: text, finalOutput: text,
    rationale: z.string().max(30_000).optional(),
  }).strict().default({}),
});

/** Autosave and stage submissions. Stage rules, limits, deadline and idempotency are enforced in SQL. */
export async function POST(req: NextRequest) {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 200 * 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('student_round2_save', {
      p_sid: auth.claims.sid, p_entry: auth.claims.sub, p_action: body.data.action, p_fields: body.data.fields,
    });
    if (error) throw error;
    if (!data?.ok) return rpcFailure(data ?? {});
    return jsonOk(data);
  } catch (err) {
    return serverError('round2 save', err, 'Could not save. Retrying…');
  }
}
