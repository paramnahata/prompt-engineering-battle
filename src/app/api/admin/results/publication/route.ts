import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, rpcResponse, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** What students can see. Nothing is visible until an admin publishes it. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('event_settings').select('value, updated_at').eq('key', 'results_publication').maybeSingle();
    if (error) throw error;
    const ids = ['round1', 'final'].map((k) => (data?.value as Record<string, { publishedBy?: string }> | undefined)?.[k]?.publishedBy).filter(Boolean) as string[];
    const { data: admins } = ids.length ? await db.from('admins').select('id, full_name, email').in('id', ids) : { data: [] };
    return jsonOk({ settings: data?.value ?? {}, updatedAt: data?.updated_at ?? null, publishers: admins ?? [] });
  } catch (err) {
    return serverError('results publication', err, 'Could not load publication settings.');
  }
}

const bodySchema = z.object({
  scope: z.enum(['round1', 'final']),
  settings: z.object({
    published: z.boolean().optional(), showScore: z.boolean().optional(), showRank: z.boolean().optional(),
    showQualification: z.boolean().optional(), showFeedback: z.boolean().optional(), showLeaderboard: z.boolean().optional(),
    leaderboardSize: z.number().int().min(1).max(100).optional(),
  }).strict(),
});

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 2048);
  if (!body.ok) return body.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('set_results_publication', { p_admin: auth.session.userId, p_scope: body.data.scope, p_settings: body.data.settings });
    if (error) throw error;
    return rpcResponse(data, 'Could not update publication settings.');
  } catch (err) {
    return serverError('results publication save', err, 'Could not update publication settings.');
  }
}
