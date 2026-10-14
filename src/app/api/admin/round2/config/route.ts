import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Round 2 configuration + readiness check (preflight) + the problem/twist pools to choose from. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const [pre, problems, twists, round] = await Promise.all([
      db.rpc('round2_preflight'),
      db.from('round2_problems').select('id, problem_code, title, active').order('created_at'),
      db.from('surprise_twists').select('id, title, active').order('created_at'),
      db.from('rounds').select('status').eq('round_number', 2).maybeSingle(),
    ]);
    if (pre.error) throw pre.error;
    return jsonOk({ preflight: pre.data, problems: problems.data ?? [], twists: twists.data ?? [], roundStatus: round.data?.status ?? 'not_started' });
  } catch (err) {
    return serverError('round2 config', err, 'Could not load Round 2 settings.');
  }
}

const criterion = z.object({
  key: z.enum(['understanding', 'response_quality', 'adaptability', 'interaction']),
  label: z.string().trim().min(1).max(60),
  max: z.number().min(0).max(100),
});
const configSchema = z.object({
  durationMinutes: z.number().int().min(5).max(240),
  problemMode: z.enum(['common', 'random']),
  commonProblemId: z.string().uuid().nullable(),
  twist: z.object({ enabled: z.boolean(), mode: z.enum(['common', 'random']), commonTwistId: z.string().uuid().nullable() }),
  jury: z.object({ enabled: z.boolean(), criteria: z.array(criterion).length(4) }),
  ai: z.object({ enabled: z.boolean(), maxPoints: z.number().min(0).max(200) }),
  limits: z.object({ promptWords: z.number().int().min(20).max(5000), outputChars: z.number().int().min(100).max(50000), rationaleWords: z.number().int().min(0).max(3000) }),
  final: z.object({ round1Weight: z.number().min(0).max(10), round2Weight: z.number().min(0).max(10) }),
}).strict();

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, configSchema, 8 * 1024);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('round2_save_config', { p_admin: auth.session.userId, p_config: body.data });
    if (error) throw error;
    return rpcResponse(data, 'Could not save the Round 2 settings.');
  } catch (err) {
    return serverError('round2 config save', err, 'Could not save the Round 2 settings.');
  }
}
