import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { readJson, rpcResponse, serverError } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({ entryId: z.string().uuid(), question: z.string().trim().min(3).max(2000) });

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['judge', 'admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 8 * 1024);
  if (!body.ok) return body.response;
  try {
    const limited = await limitAction(`jury-question:${auth.session.userId}`, 60, 300);
    if (limited) return limited;
    const isJudge = auth.session.role === 'judge';
    const { data, error } = await supabaseAdmin().rpc('jury_ask_question', {
      p_judge: isJudge ? auth.session.userId : null, p_admin: isJudge ? null : auth.session.userId,
      p_entry: body.data.entryId, p_question: body.data.question,
    });
    if (error) throw error;
    return rpcResponse(data);
  } catch (err) {
    return serverError('jury question', err, 'Could not send the question.');
  }
}
