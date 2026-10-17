import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/server';
import { studentClaims } from '@/lib/auth/student';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';
import { feedbackSchema, feedbackStatus, isMissingTable } from '@/lib/feedback';

export const dynamic = 'force-dynamic';

async function alive(sid: string) {
  const { data } = await supabaseAdmin().rpc('auth_session_validate', { p_sid: sid, p_touch: false });
  return Boolean(data?.valid);
}

/** Whether this team still has to give Round 1 feedback. */
export async function GET() {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  try {
    if (!(await alive(auth.claims.sid))) return jsonError('Your session has ended. Please sign in again.', 401);
    return jsonOk({ ok: true, ...(await feedbackStatus(supabaseAdmin(), auth.claims.sub)) });
  } catch (err) {
    return serverError('feedback status', err, 'Could not check feedback.');
  }
}

/** Saves the team's feedback (once; a second submission is ignored). */
export async function POST(req: NextRequest) {
  const auth = studentClaims();
  if (!auth.ok) return auth.response;
  const body = await readJson(req, feedbackSchema, 8 * 1024);
  if (!body.ok) return body.response;
  try {
    if (!(await alive(auth.claims.sid))) return jsonError('Your session has ended. Please sign in again.', 401);
    const f = body.data;
    const { error } = await supabaseAdmin().from('round1_feedback').upsert({
      entry_id: auth.claims.sub, overall_rating: f.overall, system_rating: f.system, management_rating: f.management,
      challenge_level: f.challengeLevel, join_again: f.joinAgain, liked: f.liked, suggestions: f.suggestions || null,
    }, { onConflict: 'entry_id', ignoreDuplicates: true });
    if (error) {
      if (isMissingTable(error)) return jsonOk({ ok: true, stored: false });
      throw error;
    }
    return jsonOk({ ok: true, stored: true });
  } catch (err) {
    return serverError('feedback save', err, 'Could not save your feedback. Please try again.');
  }
}
