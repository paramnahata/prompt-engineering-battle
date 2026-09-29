import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyPassword } from '@/lib/auth/password';
import { createSession, Role } from '@/lib/auth/session';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { email, password } = parsed.data;

  let admin;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('admins')
      .select('id, password_hash, role')
      .eq('email', email.toLowerCase())
      .single();
    // A missing row is a normal "not found" — that's a real 401, not a config problem.
    if (error && error.code !== 'PGRST116') throw error;
    admin = data;
  } catch (err) {
    // Anything else (bad SUPABASE_URL/SUPABASE_SECRET_KEY, network, etc.) is a
    // server misconfiguration, not "wrong password" — surface it distinctly so
    // it doesn't get misread as a typo in the password.
    console.error('[admin login] Supabase error:', err);
    return NextResponse.json(
      { error: 'Server misconfigured: could not reach the database. Check SUPABASE_URL / SUPABASE_SECRET_KEY.' },
      { status: 500 }
    );
  }

  if (!admin || !verifyPassword(password, admin.password_hash)) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  const role: Role = admin.role === 'volunteer' ? 'volunteer' : 'admin';
  createSession({ role, userId: admin.id, issuedAt: Date.now() });
  return NextResponse.json({ ok: true, role });
}
