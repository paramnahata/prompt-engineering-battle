import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, readJson, rpcResponse, serverError } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';

export const dynamic = 'force-dynamic';

const optText = (max: number) => z.string().max(max).nullable().optional().transform((v) => (v && v.trim() ? v.trim() : null));
const problem = z.object({
  problem_code: z.string().trim().min(1).max(40).transform((v) => v.replace(/\s+/g, '').toUpperCase()),
  title: z.string().trim().min(1).max(200),
  problem_statement: z.string().trim().min(1).max(10_000),
  category: optText(120),
  difficulty: optText(60),
  twist_title: optText(200),
  twist_description: optText(10_000),
  sample_prompt: optText(10_000),
  expected_output: optText(10_000),
  evaluation_criteria: optText(5000),
}).strict();

const bodySchema = z.object({
  problems: z.array(problem).min(1).max(200)
    .refine((list) => new Set(list.map((p) => p.problem_code)).size === list.length, 'Each problem code must be unique.'),
  disableOthers: z.boolean().default(false),
}).strict();

/**
 * Publishes a Round 2 problem pack that the admin's browser extracted from a
 * .docx (see src/lib/round2/pack.ts). Problems are inserted or updated by code
 * in one transaction; teams that already received a problem keep their snapshot.
 */
export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024 * 1024);
  if (!body.ok) return body.response;
  try {
    const limited = await limitAction(`round2-import:${auth.session.userId}`, 20, 600);
    if (limited) return limited;
    const { data, error } = await supabaseAdmin().rpc('round2_import_problems', {
      p_admin: auth.session.userId, p_problems: body.data.problems, p_disable_others: body.data.disableOthers,
    });
    if (error?.message?.includes('ROUND2_IMPORT_DUPLICATE')) return jsonError('Each problem code must be unique.', 400);
    if (error?.message?.includes('ROUND2_IMPORT_INVALID')) return jsonError('Every problem needs a code, title and statement.', 400);
    if (error) throw error;
    return rpcResponse(data, 'Could not import the problems.');
  } catch (err) {
    return serverError('round2 problem import', err, 'Could not import the problems.');
  }
}
