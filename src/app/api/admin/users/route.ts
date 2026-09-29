import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { requireRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hashPassword } from '@/lib/auth/password';

/** Only real admins manage accounts — not volunteers, not judges. */

export async function GET() {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const db = supabaseAdmin();
  const [{ data: admins }, { data: judges }] = await Promise.all([
    db.from('admins').select('id, email, full_name, role, created_at'),
    db.from('judges').select('id, email, full_name, active, created_at'),
  ]);

  const users = [
    ...(admins ?? []).map((a) => ({
      id: a.id,
      kind: a.role as 'admin' | 'volunteer',
      email: a.email,
      full_name: a.full_name,
      created_at: a.created_at,
    })),
    ...(judges ?? []).map((j) => ({
      id: j.id,
      kind: 'judge' as const,
      email: j.email,
      full_name: j.full_name,
      active: j.active,
      created_at: j.created_at,
    })),
  ];

  return NextResponse.json({ users });
}

const createSchema = z.object({
  kind: z.enum(['admin', 'volunteer', 'judge']),
  email: z.string().email(),
  full_name: z.string().min(1),
  password: z.string().min(6),
});

export async function POST(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = createSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { kind, email, full_name, password } = parsed.data;

  const db = supabaseAdmin();
  const password_hash = hashPassword(password);

  if (kind === 'judge') {
    const { error } = await db.from('judges').insert({ email: email.toLowerCase(), full_name, password_hash, active: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  } else {
    const { error } = await db.from('admins').insert({ email: email.toLowerCase(), full_name, password_hash, role: kind });
    if (error) return NextResponse.json({ error: error.message }, { status: 409 });
  }

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'create_account',
    new_value: { kind, email },
  });

  return NextResponse.json({ ok: true });
}

const patchSchema = z.object({
  kind: z.enum(['admin', 'volunteer', 'judge']),
  id: z.string().uuid(),
  newPassword: z.string().min(6),
});

export async function PATCH(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { kind, id, newPassword } = parsed.data;

  const db = supabaseAdmin();
  const password_hash = hashPassword(newPassword);
  const table = kind === 'judge' ? 'judges' : 'admins';
  const { error } = await db.from(table).update({ password_hash }).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'reset_password',
    new_value: { kind, id },
  });

  return NextResponse.json({ ok: true });
}

const deleteSchema = z.object({ kind: z.enum(['admin', 'volunteer', 'judge']), id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const session = requireRole('admin');
  if (!session) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const parsed = deleteSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { kind, id } = parsed.data;

  if (kind !== 'judge' && id === session.userId) {
    return NextResponse.json({ error: "You can't delete your own account while signed in as it." }, { status: 400 });
  }

  const db = supabaseAdmin();
  const table = kind === 'judge' ? 'judges' : 'admins';
  const { error } = await db.from(table).delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  await db.from('admin_actions').insert({
    admin_id: session.userId,
    action: 'delete_account',
    old_value: { kind, id },
  });

  return NextResponse.json({ ok: true });
}
