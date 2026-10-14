import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, readJson, serverError } from '@/lib/http';
import { poolLockedResponse } from '@/lib/challenges/server';

export const dynamic = 'force-dynamic';

const level = z.enum(['easy', 'medium', 'hard', 'expert', 'unrated']);
const rulesSchema = z.object({
  allowedDifficulties: z.array(level).min(1, 'Allow at least one difficulty').max(5),
  slot3Difficulties: z.array(level).max(5),
  slot4Difficulties: z.array(level).max(5),
  allowedCategories: z.array(z.string().trim().min(1).max(120)).max(100),
  distinctCategories: z.boolean(),
});

/** Assignment rules for random slots 3 and 4 + the resulting readiness check. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('round1_preflight');
    if (error) throw error;
    return jsonOk({ rules: data?.rules, preflight: data });
  } catch (err) {
    return serverError('rules get', err, 'Could not load the rules.');
  }
}

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, rulesSchema, 16 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const locked = await poolLockedResponse(db);
    if (locked) return locked;
    const { error } = await db.from('event_settings').upsert({ key: 'round1_assignment_rules', value: body.data, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'assignment_rules_update', new_value: body.data });
    const { data } = await db.rpc('round1_preflight');
    return jsonOk({ ok: true, rules: data?.rules, preflight: data });
  } catch (err) {
    return serverError('rules update', err, 'Could not save the rules.');
  }
}
