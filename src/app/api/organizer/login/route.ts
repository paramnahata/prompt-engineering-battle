import { NextRequest } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { createOrganizerSession, homeForRole, readSessionClaims, type Role } from '@/lib/auth/session';
import { clientIp, jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.string().trim().email().max(254),
  password: z.string().min(1).max(256),
});

// Used to keep response timing similar whether or not the email exists.
let dummyHash: string | null = null;

/**
 * One login for every organizer role. Admin/volunteer accounts live in
 * `admins`, judges in `judges`. The session role is taken only from a
 * recognised database value — unknown roles are rejected, never promoted.
 */
export async function POST(req: NextRequest) {
  const body = await readJson(req, bodySchema, 4 * 1024);
  if (!body.ok) return body.response;
  const email = body.data.email.toLowerCase();
  const { password } = body.data;
  const db = supabaseAdmin();

  try {
    const ipKey = `organizer-login-ip:${clientIp(req)}`;
    const emailKey = `organizer-login-email:${email}`;
    const [{ data: ipOk, error: ipErr }, { data: emailOk, error: emailErr }] = await Promise.all([
      db.rpc('rate_limit_hit', { p_key: ipKey, p_limit: 40, p_window_seconds: 900, p_increment: true }),
      db.rpc('rate_limit_hit', { p_key: emailKey, p_limit: 6, p_window_seconds: 900, p_increment: false }),
    ]);
    if (ipErr || emailErr) throw ipErr ?? emailErr;
    if (!ipOk || !emailOk) {
      return jsonError('Too many sign-in attempts. Wait 15 minutes and try again.', 429);
    }

    let role: Exclude<Role, 'student'> | null = null;
    let userId: string | null = null;

    const { data: admin, error: adminErr } = await db
      .from('admins').select('id, password_hash, role').eq('email', email).maybeSingle();
    if (adminErr) throw adminErr;

    if (admin) {
      if (verifyPassword(password, admin.password_hash) && (admin.role === 'admin' || admin.role === 'volunteer')) {
        role = admin.role;
        userId = admin.id;
      }
    } else {
      const { data: judge, error: judgeErr } = await db
        .from('judges').select('id, password_hash, active').eq('email', email).maybeSingle();
      if (judgeErr) throw judgeErr;
      if (judge) {
        if (judge.active && verifyPassword(password, judge.password_hash)) {
          role = 'judge';
          userId = judge.id;
        }
      } else {
        dummyHash ??= hashPassword('timing-equalizer');
        verifyPassword(password, dummyHash);
      }
    }

    if (!role || !userId) {
      await db.rpc('rate_limit_hit', { p_key: emailKey, p_limit: 6, p_window_seconds: 900, p_increment: true });
      return jsonError('Invalid email or password.', 401);
    }

    // Replace any session this browser already had (prevents fixation / role mixing).
    const previous = readSessionClaims();
    if (previous) {
      await db.from('auth_sessions').update({ ended_at: new Date().toISOString(), end_reason: 'replaced_on_device' })
        .eq('id', previous.sid).is('ended_at', null);
    }
    await createOrganizerSession(role, userId);
    return jsonOk({ ok: true, role, home: homeForRole(role) });
  } catch (err) {
    return serverError('organizer login', err, 'Sign-in is temporarily unavailable. Please retry.');
  }
}
