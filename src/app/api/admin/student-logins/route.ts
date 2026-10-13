import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonOk, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const ONLINE_SECONDS = 45;
const IDLE_SECONDS = 180;

/**
 * Live participants: the latest session per entry (last 24h) with status
 * derived from heartbeats — online (heartbeat < 45s and tab visible),
 * idle (heartbeat < 3 min, or tab hidden), offline (older, logged out or
 * expired). No tokens, access codes or contact details are returned.
 */
export async function GET() {
  const auth = await requireApiRole(['admin', 'volunteer']);
  if (!auth.ok) return auth.response;
  try {
    const { data, error } = await supabaseAdmin().rpc('admin_live_participants', {
      p_online_seconds: ONLINE_SECONDS,
      p_idle_seconds: IDLE_SECONDS,
    });
    if (error) throw error;
    const rows = (data ?? []) as { status: string }[];
    const summary = { online: 0, idle: 0, offline: 0 };
    for (const r of rows) if (r.status in summary) summary[r.status as keyof typeof summary] += 1;
    return jsonOk({ serverNow: new Date().toISOString(), summary, participants: rows, onlineSeconds: ONLINE_SECONDS, idleSeconds: IDLE_SECONDS });
  } catch (err) {
    return serverError('live participants', err, 'Could not load live participants.');
  }
}
