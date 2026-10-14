import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Round 1 timing and qualification settings (locked while the round runs). */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const [{ data: round, error }, { data: q }] = await Promise.all([
      db.from('rounds').select('status, config').eq('round_number', 1).maybeSingle(),
      db.from('event_settings').select('value').eq('key', 'qualification_percent').maybeSingle(),
    ]);
    if (error) throw error;
    const cfg = (round?.config ?? {}) as { challenge_seconds?: number; round_duration_seconds?: number };
    return jsonOk({
      status: round?.status ?? 'not_started',
      challengeSeconds: cfg.challenge_seconds ?? 450,
      roundDurationSeconds: cfg.round_duration_seconds ?? 1800,
      qualificationPercent: Number(q?.value ?? 15) || 15,
    });
  } catch (err) {
    return serverError('round1 settings', err, 'Could not load Round 1 settings.');
  }
}

const bodySchema = z.object({
  challengeSeconds: z.number().int().min(60).max(3600),
  roundDurationSeconds: z.number().int().min(300).max(4 * 3600),
  qualificationPercent: z.number().min(1).max(100),
}).refine((v) => v.roundDurationSeconds >= v.challengeSeconds, { message: 'The round must be at least as long as one challenge.' });

export async function PUT(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, bodySchema, 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { data: round, error } = await db.from('rounds').select('id, status, config').eq('round_number', 1).single();
    if (error) throw error;
    if (round.status === 'running' || round.status === 'paused') return jsonError('Round 1 is running; its timing is locked.', 409);
    const config = { ...(round.config ?? {}), challenge_seconds: body.data.challengeSeconds, round_duration_seconds: body.data.roundDurationSeconds };
    const { error: upErr } = await db.from('rounds').update({ config }).eq('id', round.id).in('status', ['not_started', 'ended']);
    if (upErr) throw upErr;
    await db.from('event_settings').upsert({ key: 'qualification_percent', value: body.data.qualificationPercent, updated_at: new Date().toISOString() }, { onConflict: 'key' });
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round1_settings', old_value: round.config, new_value: { ...config, qualification_percent: body.data.qualificationPercent } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('round1 settings save', err, 'Could not save Round 1 settings.');
  }
}
