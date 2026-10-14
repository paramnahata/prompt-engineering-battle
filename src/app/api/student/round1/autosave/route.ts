import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { rpcFailure, studentClaims } from '@/lib/auth/student';
import { jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  submissionId: z.string().uuid(),
  promptText: z.string().max(20_000),
  aiOutputText: z.string().max(20_000),
});

export async function POST(req: NextRequest) {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 128 * 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('student_autosave', {
      p_sid: auth.claims.sid,
      p_entry: auth.claims.sub,
      p_submission: body.data.submissionId,
      p_prompt: body.data.promptText,
      p_output: body.data.aiOutputText,
    });
    if (error) throw error;
    if (!data?.ok) return rpcFailure(data ?? {});
    return jsonOk({ ok: true, savedAt: data.savedAt });
  } catch (err) {
    return serverError('autosave', err, 'Could not save your draft. Retrying…');
  }
}
