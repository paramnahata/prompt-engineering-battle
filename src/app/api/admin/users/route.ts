import { NextRequest } from 'next/server';
import { z } from 'zod';
import { endSessionsForSubject, requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { hashPassword } from '@/lib/auth/password';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Only admins manage accounts — not volunteers, not judges. */

export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const [admins, judges] = await Promise.all([
      db.from('admins').select('id, email, full_name, role, created_at').order('created_at'),
      db.from('judges').select('id, email, full_name, active, created_at').order('created_at'),
    ]);
    if (admins.error || judges.error) throw admins.error ?? judges.error;
    const users = [
      ...(admins.data ?? []).filter((a) => a.role === 'admin' || a.role === 'volunteer').map((a) => ({
        id: a.id, kind: a.role as 'admin' | 'volunteer', email: a.email, full_name: a.full_name, created_at: a.created_at,
      })),
      ...(judges.data ?? []).map((j) => ({
        id: j.id, kind: 'judge' as const, email: j.email, full_name: j.full_name, active: j.active, created_at: j.created_at,
      })),
    ];
    return jsonOk({ users, me: auth.session.userId });
  } catch (err) {
    return serverError('users list', err, 'Could not load accounts.');
  }
}

const kind = z.enum(['admin', 'volunteer', 'judge']);
const password = z.string().min(8, 'Use at least 8 characters').max(128);

const createSchema = z.object({
  kind,
  email: z.string().trim().email().max(254),
  full_name: z.string().trim().min(1).max(120),
  password,
});

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, createSchema, 4096);
  if (!body.ok) return body.response;
  const { kind: k, full_name } = body.data;
  const email = body.data.email.toLowerCase();
  try {
    const db = supabaseAdmin();
    const [a, j] = await Promise.all([
      db.from('admins').select('id').eq('email', email).maybeSingle(),
      db.from('judges').select('id').eq('email', email).maybeSingle(),
    ]);
    if (a.data || j.data) return jsonError('An account with this email already exists.', 409);
    const password_hash = hashPassword(body.data.password);
    const { error } = k === 'judge'
      ? await db.from('judges').insert({ email, full_name, password_hash, active: true })
      : await db.from('admins').insert({ email, full_name, password_hash, role: k });
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'create_account', new_value: { kind: k, email } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('create account', err, 'Could not create the account.');
  }
}

const patchSchema = z.object({ kind, id: z.string().uuid(), newPassword: password });

/** Password reset. Signs the account out everywhere. */
export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, patchSchema, 4096);
  if (!body.ok) return body.response;
  const { kind: k, id, newPassword } = body.data;
  try {
    const db = supabaseAdmin();
    const table = k === 'judge' ? 'judges' : 'admins';
    const { data, error } = await db.from(table).update({ password_hash: hashPassword(newPassword) }).eq('id', id).select('id').maybeSingle();
    if (error) throw error;
    if (!data) return jsonError('Account not found.', 404);
    if (id !== auth.session.userId) await endSessionsForSubject(id, 'password_reset');
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'reset_password', new_value: { kind: k, id } });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('reset password', err, 'Could not reset the password.');
  }
}

const deleteSchema = z.object({ kind, id: z.string().uuid() });

export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 1024);
  if (!body.ok) return body.response;
  try {
    // Locked in SQL so two admins can't delete each other and leave none.
    const { data, error } = await supabaseAdmin().rpc('delete_organizer_account', {
      p_admin: auth.session.userId, p_kind: body.data.kind, p_id: body.data.id,
    });
    if (error) throw error;
    if (!data?.ok) return jsonError(data?.message ?? 'Could not delete the account.', data?.status ?? 409, { code: data?.code });
    return jsonOk({ ok: true });
  } catch (err) {
    return serverError('delete account', err, 'Could not delete the account.');
  }
}
