import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, Role } from '@/lib/auth/session';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

/**
 * One login for every organizer-side role. Tries the admins table first
 * (covers 'admin' and 'volunteer' roles), then falls back to judges.
 * Whichever table matches determines the session role — the person never
 * has to know or pick which portal their account belongs to.
 */
export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { email, password } = parsed.data;
  const lowerEmail = email.toLowerCase();

  let role: Role | null = null;
  let userId: string | null = null;

  try {
    const db = supabaseAdmin();

    const { data: admin, error: adminErr } = await db
      .from('admins')
      .select('id, password_hash, role')
      .eq('email', lowerEmail)
      .single();
    if (adminErr && adminErr.code !== 'PGRST116') throw adminErr;

    if (admin && verifyPassword(password, admin.password_hash)) {
      role = admin.role === 'volunteer' ? 'volunteer' : 'admin';
      userId = admin.id;
    } else {
      const { data: judge, error: judgeErr } = await db
        .from('judges')
        .select('id, password_hash, active')
        .eq('email', lowerEmail)
        .single();
      if (judgeErr && judgeErr.code !== 'PGRST116') throw judgeErr;

      if (judge && judge.active && verifyPassword(password, judge.password_hash)) {
        role = 'judge';
        userId = judge.id;
      }
    }
  } catch (err) {
    console.error('[organizer login] Supabase error:', err);
    return NextResponse.json(
      { error: 'Server misconfigured: could not reach the database. Check SUPABASE_URL / SUPABASE_SECRET_KEY.' },
      { status: 500 }
    );
  }

  if (!role || !userId) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  createSession({ role, userId, issuedAt: Date.now() });
  return NextResponse.json({ ok: true, role });
}
