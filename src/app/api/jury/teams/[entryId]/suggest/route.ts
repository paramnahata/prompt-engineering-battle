import { NextRequest } from 'next/server';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, serverError, uuidSchema } from '@/lib/http';
import { limitAction } from '@/lib/ops/rate-limit';
import { generateJson, GeminiConfigError, GeminiRateLimitError } from '@/lib/gemini/evaluator';
import { buildSuggestMessage, parseSuggestResponse, SUGGEST_SCHEMA, SUGGEST_SYSTEM } from '@/lib/round2/questions';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Optional AI-written viva questions for one finalist (uses the organizer's
 * Gemini key; the built-in suggestions in GET /api/jury/teams/[entryId] work
 * without it). Rate-limited per judge so a free-tier key is not exhausted.
 */
export async function POST(_req: NextRequest, { params }: { params: { entryId: string } }) {
  const auth = await requireApiRole(['judge', 'admin']);
  if (!auth.ok) return auth.response;
  const entryId = uuidSchema.safeParse(params.entryId);
  if (!entryId.success) return jsonError('Team not found.', 404);
  try {
    const limited = await limitAction(`jury-suggest:${auth.session.userId}`, 12, 600);
    if (limited) return limited;
    const db = supabaseAdmin();
    const [state, asg] = await Promise.all([
      db.from('round2_states').select('initial_prompt, initial_output, final_prompt, final_output, rationale, twist_snapshot, twist_revealed_at').eq('entry_id', entryId.data).maybeSingle(),
      db.from('round2_assignments').select('problem_snapshot').eq('entry_id', entryId.data).maybeSingle(),
    ]);
    if (state.error) throw state.error;
    if (!state.data) return jsonError('That team is not in Round 2.', 404);
    const w = state.data;
    if (!(w.final_prompt || w.initial_prompt)) return jsonError('This team has not written a prompt yet.', 409);
    const problem = (asg.data?.problem_snapshot ?? null) as Record<string, string | null> | null;
    const twist = w.twist_revealed_at ? (w.twist_snapshot as { title?: string; description?: string } | null) : null;
    const { text } = await generateJson(SUGGEST_SYSTEM, buildSuggestMessage({ problem, twist, work: w }), SUGGEST_SCHEMA);
    return jsonOk({ questions: parseSuggestResponse(text) });
  } catch (err) {
    if (err instanceof GeminiConfigError) return jsonError('AI suggestions need a Gemini API key (Admin → AI Judging). The built-in suggestions still work.', 503);
    if (err instanceof GeminiRateLimitError) return jsonError('The AI is busy right now. Use the built-in suggestions or try again in a minute.', 429);
    return serverError('jury suggest', err, 'Could not get AI suggestions. Use the built-in ones.');
  }
}
