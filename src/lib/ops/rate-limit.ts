import 'server-only';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError } from '@/lib/http';

/**
 * Fixed-window rate limit backed by the `rate_limit_hit` SQL function.
 * Used for expensive or sensitive organizer actions (evaluation runs,
 * exports, PIN issuance, resets, imports). Returns a ready 429 response
 * when the caller is over the limit.
 */
export async function limitAction(key: string, limit: number, windowSeconds: number) {
  const { data, error } = await supabaseAdmin().rpc('rate_limit_hit', {
    p_key: key, p_limit: limit, p_window_seconds: windowSeconds, p_increment: true,
  });
  if (error) throw error;
  return data === true ? null : jsonError(`Too many requests for this action. Wait ${Math.ceil(windowSeconds / 60)} minute(s) and retry.`, 429);
}
