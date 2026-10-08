import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase/server';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';

const bodySchema = z.object({ email: z.string().email(), password: z.string().min(1) });

export async function POST(req: NextRequest) {
  const parsed = bodySchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
  const { email, password } = parsed.data;

  let judge;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db
      .from('judges')
      .select('id, password_hash, active')
      .eq('email', email.toLowerCase())
      .single();
    if (error && error.code !== 'PGRST116') throw error;
    judge = data;
  } catch (err) {
    console.error('[judge login] Supabase error:', err);
    return NextResponse.json(
      { error: 'Server misconfigured: could not reach the database. Check SUPABASE_URL / SUPABASE_SECRET_KEY.' },
      { status: 500 }
    );
  }

  if (!judge || !judge.active || !verifyPassword(password, judge.password_hash)) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 });
  }

  createSession({ role: 'judge', userId: judge.id, issuedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
