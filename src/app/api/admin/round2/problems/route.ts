import { NextRequest } from 'next/server';
import { z } from 'zod';
import { requireApiRole } from '@/lib/auth/session';
import { supabaseAdmin } from '@/lib/supabase/server';
import { jsonError, jsonOk, readJson, serverError } from '@/lib/http';

export const dynamic = 'force-dynamic';

const optText = (max: number) => z.string().trim().max(max).nullable().optional().transform((v) => (v ? v : null));
const fields = z.object({
  problem_code: z.string().trim().min(1).max(40).transform((v) => v.replace(/\s+/g, '').toUpperCase()),
  title: z.string().trim().min(1).max(200),
  problem_statement: z.string().trim().min(1).max(10_000),
  instructions: optText(5000),
  constraints: optText(5000),
  expected_output: optText(10_000),
  evaluation_criteria: optText(5000),
  active: z.boolean().optional(),
});

const SELECT = 'id, problem_code, title, problem_statement, instructions, constraints, expected_output, evaluation_criteria, active, created_at, updated_at';

/** Round 2 problems. Teams get a snapshot at start, so edits never change work in progress. */
export async function GET() {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  try {
    const db = supabaseAdmin();
    const [{ data, error }, { data: used }] = await Promise.all([
      db.from('round2_problems').select(SELECT).order('created_at'),
      db.from('round2_assignments').select('problem_id').limit(1000),
    ]);
    if (error) throw error;
    const usage = new Map<string, number>();
    for (const u of used ?? []) usage.set(u.problem_id, (usage.get(u.problem_id) ?? 0) + 1);
    return jsonOk({ problems: (data ?? []).map((p) => ({ ...p, assigned: usage.get(p.id) ?? 0 })) });
  } catch (err) {
    return serverError('round2 problems', err, 'Could not load Round 2 problems.');
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, fields, 48 * 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { data, error } = await db.from('round2_problems').insert({ ...body.data, active: body.data.active ?? true, updated_by: auth.session.userId }).select(SELECT).single();
    if (error?.code === '23505') return jsonError(`A problem with code ${body.data.problem_code} already exists.`, 409);
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_problem_create', new_value: { id: data.id, code: data.problem_code } });
    return jsonOk({ ok: true, problem: data });
  } catch (err) {
    return serverError('round2 problem create', err, 'Could not save the problem.');
  }
}

const patchSchema = fields.partial().extend({ id: z.string().uuid() });

export async function PATCH(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, patchSchema, 48 * 1024);
  if (!body.ok) return body.response;
  const { id, ...changes } = body.data;
  try {
    const db = supabaseAdmin();
    const { data: before } = await db.from('round2_problems').select(SELECT).eq('id', id).maybeSingle();
    if (!before) return jsonError('Problem not found.', 404);
    const { data, error } = await db.from('round2_problems').update({ ...changes, updated_at: new Date().toISOString(), updated_by: auth.session.userId }).eq('id', id).select(SELECT).single();
    if (error?.code === '23505') return jsonError('Another problem already uses that code.', 409);
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_problem_update', old_value: before, new_value: data });
    return jsonOk({ ok: true, problem: data });
  } catch (err) {
    return serverError('round2 problem update', err, 'Could not update the problem.');
  }
}

const deleteSchema = z.object({ id: z.string().uuid(), confirm: z.literal('DELETE') });

/** Deletes an unused problem; a problem already given to teams is disabled instead (history is kept). */
export async function DELETE(req: NextRequest) {
  const auth = await requireApiRole(['admin']);
  if (!auth.ok) return auth.response;
  const body = await readJson(req, deleteSchema, 1024);
  if (!body.ok) return body.response;
  try {
    const db = supabaseAdmin();
    const { count } = await db.from('round2_assignments').select('id', { count: 'exact', head: true }).eq('problem_id', body.data.id);
    if ((count ?? 0) > 0) {
      const { error } = await db.from('round2_problems').update({ active: false, updated_by: auth.session.userId, updated_at: new Date().toISOString() }).eq('id', body.data.id);
      if (error) throw error;
      await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_problem_disable', new_value: { id: body.data.id } });
      return jsonOk({ ok: true, disabled: true });
    }
    const { error } = await db.from('round2_problems').delete().eq('id', body.data.id);
    if (error) throw error;
    await db.from('admin_actions').insert({ admin_id: auth.session.userId, action: 'round2_problem_delete', old_value: { id: body.data.id } });
    return jsonOk({ ok: true, deleted: true });
  } catch (err) {
    return serverError('round2 problem delete', err, 'Could not delete the problem.');
  }
}
